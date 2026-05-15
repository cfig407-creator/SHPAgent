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

async function getSendsForProspect(prospectId) {
  const trackingIds = (await kvGet(`shp:trackindex:${prospectId}`)) || [];
  const sends = [];
  for (const tid of trackingIds) {
    const [meta, opens] = await Promise.all([
      kvGet(`shp:trackmeta:${tid}`),
      kvGet(`shp:opens:${tid}`),
    ]);
    sends.push({ trackingId: tid, meta: meta || null, opens: opens || [] });
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
      const opens = (await kvGet(`shp:opens:${id}`)) || [];
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
