// Vercel serverless function: proxies Pipedrive API calls server-side
// Token from PIPEDRIVE_API_TOKEN env var (set in Vercel dashboard)
// Domain from PIPEDRIVE_DOMAIN env var (e.g. "mycompany.pipedrive.com")

export default async function handler(req, res) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  const domain = process.env.PIPEDRIVE_DOMAIN;

  if (!token) {
    return res.status(500).json({
      error: 'PIPEDRIVE_API_TOKEN not set in Vercel environment variables',
    });
  }

  const cleanDomain = domain
    ? domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    : null;
  const baseUrl = cleanDomain
    ? `https://${cleanDomain}/api/v1`
    : 'https://api.pipedrive.com/v1';

  const { path, method = 'GET', body } = req.method === 'POST' ? req.body : req.query;

  if (!path) {
    return res.status(400).json({ error: 'Missing "path" parameter' });
  }

  // Path allowlist — restricts which Pipedrive endpoints the proxy will
  // forward to. Without this, a compromised client could call any PD API
  // (e.g. /users/me/permissions, /companies, etc.) as the configured
  // user. We only need a small set of endpoints from the frontend.
  const ALLOWED_PATH = /^\/(leads|deals|persons|organizations|activities|mailbox|stages|pipelines|users|dealFields|leadFields|currencies|callLogs|notes|files|recents)(\/|\?|$)/;
  if (!ALLOWED_PATH.test(path.startsWith('/') ? path : '/' + path)) {
    return res.status(400).json({ error: 'Pipedrive path not allowed', path });
  }

  // Method allowlist — Pipedrive uses GET/POST/PUT/PATCH/DELETE in normal
  // CRUD. Reject anything else so a request can't smuggle in OPTIONS/HEAD
  // probes or unexpected verbs.
  const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const upperMethod = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(upperMethod)) {
    return res.status(405).json({ error: 'Method not allowed', method: upperMethod });
  }

  const sep = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}${path}${sep}api_token=${encodeURIComponent(token)}`;

  try {
    const fetchOpts = {
      method: upperMethod,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body && upperMethod !== 'GET') {
      fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const pdResp = await fetch(url, fetchOpts);
    const text = await pdResp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    res.status(pdResp.status).json(json);
  } catch (err) {
    res.status(500).json({
      error: 'Proxy fetch failed',
      message: err.message,
    });
  }
}
