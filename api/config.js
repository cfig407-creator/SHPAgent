// Vercel serverless function: server-side persistence for sender identity / config
// so settings survive across browsers and devices.
//
// Storage strategy:
//   - If Vercel KV (Upstash Redis) env vars are present (KV_REST_API_URL +
//     KV_REST_API_TOKEN), we use them.
//   - Otherwise we degrade to a per-deployment in-memory map (lost on cold
//     start) and tell the client so it knows to keep its localStorage copy.
//
// This is a single-tenant app — one rep, one identity record — so we use a
// fixed key. If multi-tenant later, swap to a per-user key.
//
// GET  /api/config       → { config, persisted }
// POST /api/config { config } → { ok, persisted }

const KEY = 'shp:config:v1';
const memory = globalThis.__shpConfigMemory || (globalThis.__shpConfigMemory = { value: null });

function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet() {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!r.ok) throw new Error(`KV get ${r.status}`);
  const json = await r.json();
  if (!json?.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

async function kvSet(value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${KEY}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV set ${r.status}`);
}

export default async function handler(req, res) {
  const usingKv = kvAvailable();

  try {
    if (req.method === 'GET') {
      const value = usingKv ? await kvGet() : memory.value;
      return res.status(200).json({ config: value, persisted: usingKv });
    }

    if (req.method === 'POST') {
      const incoming = req.body?.config;
      if (!incoming || typeof incoming !== 'object') {
        return res.status(400).json({ error: 'Missing or invalid `config` body' });
      }
      if (usingKv) {
        await kvSet(incoming);
      } else {
        memory.value = incoming;
      }
      return res.status(200).json({ ok: true, persisted: usingKv });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({
      error: 'Config persistence failed',
      message: err.message,
      persisted: usingKv,
    });
  }
}
