// Query open events recorded by /api/pixel.
//
// GET /api/opens?id=<trackingId>             → { opens: [...] }
// GET /api/opens?prospectId=<id>             → { sends: [{ trackingId, meta, opens }, ...] }
// GET /api/opens?prospectIds=<id1,id2,id3>   → batch: { byProspect: { id: [...sends], ... } }
//
// The batch form is what the frontend uses to refresh the dashboard.

function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!r.ok) return null;
  const json = await r.json();
  if (!json?.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

// LRANGE for Redis lists (used for opens which are now stored as a list
// for atomic appends — see pixel.js). Returns each list entry parsed as
// JSON.
async function kvLRange(key) {
  const url = `${process.env.KV_REST_API_URL}/lrange/${encodeURIComponent(key)}/0/-1`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!r.ok) return [];
  const json = await r.json();
  const items = Array.isArray(json?.result) ? json.result : [];
  return items.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// Read trackindex with backward compat. Newer entries are Redis lists
// (atomic RPUSH writes); older entries are JSON-string arrays. Try LRANGE
// first, fall back to legacy GET-parse-array.
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
