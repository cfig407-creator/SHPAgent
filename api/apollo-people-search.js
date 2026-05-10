// Vercel serverless function: proxies Apollo's mixed_people/search endpoint
// for multi-threading at known accounts.
//
// IMPORTANT: This endpoint is for SEARCH (free) — it returns names, titles,
// and Apollo IDs but NOT verified emails. Verified emails cost 1 credit each
// and come from /api/apollo-enrich. Decoupling search from enrich is what
// lets users discover candidates without spending credits.
//
// Endpoint: POST /api/apollo-people-search
// Body: { organizationName, titles: string[], limit?: number }
// Returns: { candidates: [{ apolloId, firstName, lastName, name, title, organizationName, linkedinUrl, photoUrl }] }

export default async function handler(req, res) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'APOLLO_API_KEY not set in Vercel env vars' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { organizationName, titles = [], limit = 10 } = req.body || {};

  if (!organizationName || !Array.isArray(titles) || titles.length === 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      hint: 'Provide { organizationName, titles: [string, ...], limit? }',
    });
  }

  const payload = {
    q_organization_name: organizationName,
    person_titles: titles.slice(0, 25), // Apollo accepts arrays of titles, capped to be safe
    page: 1,
    per_page: Math.min(Math.max(limit, 1), 25),
  };

  try {
    const apolloResp = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await apolloResp.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      return res.status(apolloResp.status).json({
        error: 'Apollo returned non-JSON response',
        raw: text.slice(0, 500),
      });
    }

    if (!apolloResp.ok) {
      return res.status(apolloResp.status).json({
        error: data?.error || data?.message || 'Apollo search failed',
        details: data,
      });
    }

    const people = Array.isArray(data?.people) ? data.people : [];
    const candidates = people.map(p => ({
      apolloId: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      name: p.name,
      title: p.title,
      organizationName: p.organization?.name,
      organizationDomain: p.organization?.primary_domain,
      linkedinUrl: p.linkedin_url,
      photoUrl: p.photo_url,
      city: p.city,
      state: p.state,
    })).filter(c => c.name); // drop anything Apollo couldn't name

    return res.status(200).json({
      candidates,
      totalEntries: data.pagination?.total_entries ?? candidates.length,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Apollo people-search proxy failed',
      message: err.message,
    });
  }
}
