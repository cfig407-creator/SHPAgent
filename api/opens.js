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
import { kvAvailable, kvGet, kvLRange, kvScan } from './_kv.js';
import { requireAppKey } from './_auth.js';

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

  // App-key gate: opens data includes recipient emails + opener IPs. Block
  // anonymous enumeration of prospectIds.
  if (!requireAppKey(req, res)) return;

  if (!kvAvailable()) {
    return res.status(200).json({ ok: true, note: 'KV not configured — opens unavailable' });
  }

  const { id, prospectId, prospectIds, action } = req.query || {};

  try {
    // ── RECOVERY: rebuild the client's sent index from KV ──────────────
    // The frontend's pdRecords (which prospects were emailed) lives in
    // browser localStorage and can be lost (cleared cache, device switch,
    // M365 reconnect flow). The send metadata itself is durable in KV under
    // shp:trackmeta:{trackingId}. This scans every trackmeta key and returns
    // the sends grouped by prospectId so the client can reconstruct pdRecords.
    if (action === 'rebuild') {
      const keys = await kvScan('shp:trackmeta:*');
      const byProspect = {}; // prospectId -> { trackingIds[], sentAts[], lastSubject }
      for (const key of keys) {
        const trackingId = key.replace(/^shp:trackmeta:/, '');
        const meta = await kvGet(key);
        const pid = meta?.prospectId;
        if (!pid || !meta?.sentAt) continue;
        if (!byProspect[pid]) byProspect[pid] = { trackingIds: [], sentAts: [], lastSubject: '' };
        byProspect[pid].trackingIds.push(trackingId);
        byProspect[pid].sentAts.push(meta.sentAt);
        byProspect[pid].lastSubject = meta.subject || byProspect[pid].lastSubject;
      }
      const totalSends = Object.values(byProspect).reduce((n, p) => n + p.sentAts.length, 0);
      return res.status(200).json({ ok: true, byProspect, prospectCount: Object.keys(byProspect).length, totalSends });
    }

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
