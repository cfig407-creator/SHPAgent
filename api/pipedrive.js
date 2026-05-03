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

  const sep = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}${path}${sep}api_token=${encodeURIComponent(token)}`;

  try {
    const fetchOpts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') {
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
