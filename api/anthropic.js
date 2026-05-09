// Vercel serverless function: proxies Anthropic Messages API calls server-side.
// Keeps ANTHROPIC_API_KEY off the client. Used for prospect research (web_search tool)
// and Apollo MCP search.
//
// Endpoint: POST /api/anthropic
// Body: { model, max_tokens, messages, tools?, mcp_servers? }
// Returns: raw Anthropic response JSON, or { error, status } on failure.

export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not set in Vercel environment variables',
      hint: 'Add ANTHROPIC_API_KEY to Vercel project settings → Environment Variables',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const body = req.body || {};
  if (!body.model || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: 'Missing required fields',
      hint: 'Provide { model, messages, max_tokens? } at minimum',
    });
  }

  // Required Anthropic API headers. Beta header is needed for tools like web_search and MCP.
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const betas = [];
  if (Array.isArray(body.tools) && body.tools.some(t => t?.type?.startsWith('web_search'))) {
    betas.push('web-search-2025-03-05');
  }
  if (Array.isArray(body.mcp_servers) && body.mcp_servers.length > 0) {
    betas.push('mcp-client-2025-04-04');
  }
  if (betas.length > 0) {
    headers['anthropic-beta'] = betas.join(',');
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(r.status).json({
        error: 'Anthropic returned non-JSON response',
        raw: text.slice(0, 1000),
        status: r.status,
      });
    }

    if (!r.ok) {
      return res.status(r.status).json({
        error: data?.error?.message || data?.message || 'Anthropic API error',
        type: data?.error?.type,
        details: data,
      });
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({
      error: 'Anthropic proxy fetch failed',
      message: err.message,
    });
  }
}
