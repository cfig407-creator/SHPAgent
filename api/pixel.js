// Serves a 1×1 transparent PNG and logs the open event to Vercel KV.
//
// GET /api/pixel?id=<trackingId>
//
// Storage: shp:opens:{trackingId} = [{ at: ISO, ua: string, ip: string }, ...]
// Returns the PNG with aggressive no-cache headers so each open hits us again.
//
// Note: privacy proxies (Apple Mail, Gmail) cache image responses server-side,
// so multiple opens from the same client often resolve to a single hit. Treat
// this as a "was it loaded at least once" signal, not a reliable counter.

// 1×1 transparent PNG (43 bytes), base64-encoded so we don't need a file asset
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64'
);

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

async function kvSet(key, value) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}

function sendPixel(res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', PIXEL.length.toString());
  // Aggressive no-cache so a fresh hit registers each time the client tries
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.status(200).send(PIXEL);
}

export default async function handler(req, res) {
  const id = (req.query?.id || '').toString();

  // Always return the pixel — even if logging fails, the email must render.
  if (!id || !kvAvailable()) {
    return sendPixel(res);
  }

  try {
    const key = `shp:opens:${id}`;
    const existing = (await kvGet(key)) || [];
    existing.push({
      at: new Date().toISOString(),
      ua: (req.headers['user-agent'] || '').toString().slice(0, 300),
      ip: (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString().split(',')[0].trim(),
    });
    // Cap at 50 entries per tracking ID — protects against runaway pixel caches
    if (existing.length > 50) existing.splice(0, existing.length - 50);
    await kvSet(key, existing);
  } catch (err) {
    // Swallow — pixel must still load
    console.warn('[pixel] log open failed:', err.message);
  }

  return sendPixel(res);
}
