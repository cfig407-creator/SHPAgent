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
import { kvAvailable, kvSafeAppendList, kvLTrim } from './_kv.js';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64'
);

// Atomic RPUSH for the opens list. Avoids the read-modify-write race that
// pixel writes have when multiple opens fire concurrently (Apple Mail
// Privacy Protection and Gmail's image proxy both preload pixels, so
// parallel hits are common).

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

  // Validate the tracking ID shape — we generate `t_<timestamp>_<random>`
  // and don't want arbitrary client-controlled strings polluting KV keys.
  if (!/^t_\d{10,16}_[a-z0-9]{4,16}$/.test(id)) {
    return sendPixel(res);
  }

  try {
    const key = `shp:opens:${id}`;
    const event = {
      at: new Date().toISOString(),
      ua: (req.headers['user-agent'] || '').toString().slice(0, 300),
      ip: (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString().split(',')[0].trim(),
    };
    // Append the open event. kvSafeAppendList migrates a legacy JSON-string
    // opens key (written by the pre-refactor pixel via kvSet) to a Redis list
    // on first write — without it, RPUSH on a string key fails WRONGTYPE and
    // the open is silently lost. Trim to the last 50 afterward.
    await kvSafeAppendList(key, event);
    await kvLTrim(key, -50, -1);
  } catch (err) {
    // Swallow — pixel must still load
    console.warn('[pixel] log open failed:', err.message);
  }

  return sendPixel(res);
}
