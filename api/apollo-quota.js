// Vercel serverless function: returns the current Apollo credit usage so the UI
// can warn the user before they run out.
//
// Endpoint: GET /api/apollo-quota
// Returns: { creditsUsed, creditsTotal, creditsRemaining, planName? } or { error }

export default async function handler(req, res) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'APOLLO_API_KEY not set',
    });
  }

  try {
    // Apollo's "auth/health" endpoint returns rate/credit info. We try the
    // dedicated usage endpoint first; if Apollo's plan doesn't expose it, we
    // fall back to parsing rate-limit headers from a cheap GET.
    const r = await fetch('https://api.apollo.io/api/v1/auth/health', {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    // Read Apollo's usage from response headers when present (more reliable than
    // body shape, which varies by plan).
    const headerUsed = parseInt(r.headers.get('x-rate-limit-credit-used') || '', 10);
    const headerLimit = parseInt(r.headers.get('x-rate-limit-credit-limit') || '', 10);

    const creditsUsed = Number.isFinite(headerUsed)
      ? headerUsed
      : data?.credits_used ?? data?.usage?.used ?? null;
    const creditsTotal = Number.isFinite(headerLimit)
      ? headerLimit
      : data?.credits_total ?? data?.usage?.limit ?? null;

    const remaining = (creditsTotal != null && creditsUsed != null)
      ? Math.max(0, creditsTotal - creditsUsed)
      : null;

    return res.status(200).json({
      ok: r.ok,
      creditsUsed,
      creditsTotal,
      creditsRemaining: remaining,
      planName: data?.plan_name || null,
      raw: r.ok ? null : data,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Apollo quota fetch failed',
      message: err.message,
    });
  }
}
