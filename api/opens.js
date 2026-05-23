// Query open events recorded by /api/pixel.
//
// GET /api/opens?id=<trackingId>             → { opens: [...] }
// GET /api/opens?prospectId=<id>             → { sends: [{ trackingId, meta, opens }, ...] }
// GET /api/opens?prospectIds=<id1,id2,id3>   → batch: { byProspect: { id: [...sends], ... } }
//
// The batch form is what the frontend uses to refresh the dashboard.

// LRANGE for Redis lists (used for opens which are now stored as a list
// for atomic appends — see pixel.js). Returns each list entry parsed as
// JSON.

// Read trackindex with backward compat. Newer entries are Redis lists
// (atomic RPUSH writes); older entries are JSON-string arrays. Try LRANGE
// first, fall back to legacy GET-parse-array.
import { kvAvailable, kvGet, kvLRange } from './_kv.js';

async function readTrackIndex(prospectId) {
  const key = `shp:trackindex:${prospectId}`;
  const fromList = await kvLRange(key);
  if (fromList.length > 0) {
    // Redis list stores strings; trackingIds are already strings. The
    // kvLRange helper attempts JSON.parse, so re-stringify any that came
    // back as strings (avoid double-wrap).
    return fromList.map(v => (typeof v === 'string' ? v : JSON.stringify(v)));
  }
  // Legacy format
  const fromString = await kvGet(key);
  return Array.isArray(fromString) ? fromString : [];
}

async function getSendsForProspect(prospectId) {
  const trackingIds = await readTrackIndex(prospectId);
  const sends = [];
  for (const tid of trackingIds) {
    const [meta, opens] = await Promise.all([
      kvGet(`shp:trackmeta:${tid}`),
      kvLRange(`shp:opens:${tid}`),
    ]);
    sends.push({ trackingId: tid, meta: meta || null, opens });
  }
  return sends;
}

export default async function handler(req, res) {
  // Polling endpoint — must never be cached. Vercel's edge auto-attaches
  // ETags to JSON responses, which causes the browser to issue conditional
  // GETs and receive 304s with no body. The cached (often empty) response
  // then gets used as if it were fresh, so the dashboard tile and tracking
  // poll silently show stale data with no visible error.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (!kvAvailable()) {
    return res.status(200).json({ ok: true, note: 'KV not configured — opens unavailable' });
  }

  const { id, prospectId, prospectIds } = req.query || {};

  try {
    if (id) {
      const opens = await kvLRange(`shp:opens:${id}`);
      const meta = await kvGet(`shp:trackmeta:${id}`);
      return res.status(200).json({ trackingId: id, meta, opens });
    }

    if (prospectIds) {
      const ids = prospectIds.toString().split(',').filter(Boolean).slice(0, 200);
      const byProspect = {};
      // Sequential to avoid overwhelming KV; KV is fast enough for typical workloads
      for (const pid of ids) {
        byProspect[pid] = await getSendsForProspect(pid);
      }
      return res.status(200).json({ byProspect });
    }

    if (prospectId) {
      const sends = await getSendsForProspect(prospectId.toString());
      return res.status(200).json({ prospectId, sends });
    }

    return res.status(400).json({ error: 'Provide ?id=, ?prospectId=, or ?prospectIds=' });
  } catch (err) {
    return res.status(500).json({ error: 'opens query failed', message: err.message });
  }
}
