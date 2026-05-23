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

import dns from 'dns/promises';

// Return true if an IPv4 address falls in a non-routable / metadata range.
// Includes 169.254.0.0/16 — the AWS/GCP cloud metadata IP lives there
// (169.254.169.254) and we must NEVER let our serverless function fetch it.
function isPrivateIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  if (/^0\./.test(ip)) return true;                            // 0.0.0.0/8
  if (/^10\./.test(ip)) return true;                           // private
  if (/^127\./.test(ip)) return true;                          // loopback
  if (/^169\.254\./.test(ip)) return true;                     // link-local incl. cloud metadata
  if (/^192\.168\./.test(ip)) return true;                     // private
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;   // 172.16.0.0/12 private
  return false;
}

function isPrivateIPv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;                            // loopback
  if (lower.startsWith('fe80:')) return true;                  // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  return false;
}

// Resolve the host to one or more IPs and verify none of them are private/
// internal. Catches DNS rebinding attacks where a public hostname resolves
// to an internal IP at fetch time.
async function isHostSafe(host) {
  if (!host || host === 'localhost' || host.endsWith('.local')) return false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.length === 0) return false;
    for (const a of addrs) {
      if (a.family === 4 && isPrivateIPv4(a.address)) return false;
      if (a.family === 6 && isPrivateIPv6(a.address)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Optional shared-secret check. When SCRAPE_SECRET is set, require the
  // matching X-Shp-Secret header. Frontend doesn't need it on the same
  // origin (same-origin auth), but external callers do. Single-tenant
  // deployment can leave this unset and rely on Vercel's CORS defaults.
  if (process.env.SCRAPE_SECRET && req.headers['x-shp-secret'] !== process.env.SCRAPE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  // SSRF defense: resolve the hostname and validate every IP. Catches:
  //  - Literal internal IPs (127.0.0.1, 10.0.0.5, 169.254.169.254)
  //  - DNS rebinding (public hostname → private IP at lookup time)
  //  - IPv6 loopback / link-local / ULA
  const host = parsed.hostname.toLowerCase();
  // Allow direct-IP requests only if the IP is non-private
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) {
      return res.status(400).json({ error: 'Internal addresses not allowed' });
    }
  } else {
    const safe = await isHostSafe(host);
    if (!safe) {
      return res.status(400).json({ error: 'Host blocked or unresolvable' });
    }
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
    // Use manual redirect handling so we can re-validate the redirect
    // target's host before following. A public URL that 302's to an
    // internal IP would otherwise bypass our SSRF check.
    let currentUrl = url;
    let r;
    for (let hop = 0; hop < 5; hop++) {
      r = await fetch(currentUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (r.status < 300 || r.status >= 400) break;
      const location = r.headers.get('location');
      if (!location) break;
      const nextUrl = new URL(location, currentUrl).href;
      const nextHost = new URL(nextUrl).hostname.toLowerCase();
      // Re-validate redirect target
      if (/^\d+\.\d+\.\d+\.\d+$/.test(nextHost)) {
        if (isPrivateIPv4(nextHost)) {
          clearTimeout(timeout);
          return res.status(400).json({ error: 'Redirect target is internal', target: nextUrl });
        }
      } else {
        const ok = await isHostSafe(nextHost);
        if (!ok) {
          clearTimeout(timeout);
          return res.status(400).json({ error: 'Redirect target host blocked', target: nextUrl });
        }
      }
      currentUrl = nextUrl;
    }
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
