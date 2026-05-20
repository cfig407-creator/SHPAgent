// Server-side URL fetcher used by the directory scraper.
//
// Why: Anthropic's web_fetch beta tool was unreliable for some target sites
// (no contacts returned). Doing the fetch ourselves gives us full control
// over headers, redirects, and timeouts, AND avoids the beta dependency.
// The fetched HTML is then handed to Claude for extraction without any
// web-tool dependencies.
//
// POST /api/scrape-url
// Body: { url: string }
// Returns: { ok: true, url, status, html, contentType } on success
//          { error, status } on failure

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https URLs supported' });
  }

  // Block obvious internal/loopback addresses to prevent the function being
  // abused as an SSRF proxy. Allowlist-by-protocol would be better but this
  // is good enough for a sales tool.
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.startsWith('127.') || host.startsWith('10.') ||
      host.startsWith('192.168.') || host.endsWith('.local') || host === '0.0.0.0') {
    return res.status(400).json({ error: 'Internal addresses not allowed' });
  }

  // Browser-like User-Agent so sites don't reject us as a bot
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // 20s timeout via AbortController — protects against hung sites
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const r = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text')) {
      return res.status(415).json({
        error: 'Non-HTML response',
        contentType,
        status: r.status,
      });
    }

    const html = await r.text();
    // Cap response size — Claude has a context limit and very large pages
    // are usually navigation-heavy noise anyway. 500 KB is plenty for a
    // staff directory.
    const capped = html.length > 500_000 ? html.slice(0, 500_000) : html;

    return res.status(200).json({
      ok: true,
      url,
      status: r.status,
      contentType,
      html: capped,
      truncated: html.length > 500_000,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout fetching URL' });
    }
    return res.status(500).json({ error: 'Fetch failed', message: err.message });
  }
}
