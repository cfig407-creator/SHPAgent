// Vercel serverless function: proxies Apollo's mixed_people/search endpoint
// for multi-threading at known accounts.
//
// IMPORTANT: This endpoint is for SEARCH (free) — it returns names, titles,
// and Apollo IDs but NOT verified emails. Verified emails cost 1 credit each
// and come from /api/apollo-enrich. Decoupling search from enrich is what
// lets users discover candidates without spending credits.
//
// Endpoint: POST /api/apollo-people-search
// Body: {
//   organizationName?: string,        // narrow to one org (multi-thread use case)
//   titles: string[],                 // required: job titles to match
//   locations?: string[],             // e.g. ["Florida, US"] — filters geographically
//   orgKeywords?: string[],           // e.g. ["school district", "city of"] — segment filter
//   orgKeywordsExclude?: string[],    // healthcare exclusions etc
//   limit?: number,                   // 1-25, default 10
//   page?: number,                    // pagination, default 1
// }
// Returns: { candidates: [...], totalEntries }

export default async function handler(req, res) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'APOLLO_API_KEY not set in Vercel env vars' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const {
    organizationName,
    titles = [],
    locations = [],
    orgKeywords = [],
    orgKeywordsExclude = [],
    limit = 10,
    page = 1,
  } = req.body || {};

  if (!Array.isArray(titles) || titles.length === 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      hint: 'Provide { titles: [string, ...], plus optional organizationName / locations / orgKeywords / orgKeywordsExclude }',
    });
  }

  // Build the payload — Apollo's mixed_people/search accepts any combination of
  // org-name, location, and org-keyword filters. We bias toward the user's
  // titles and overlay whatever scoping they provided.
  const payload = {
    person_titles: titles.slice(0, 25),
    page,
    per_page: Math.min(Math.max(limit, 1), 25),
  };
  if (organizationName) payload.q_organization_name = organizationName;
  // Use organization_locations (ORG address) NOT person_locations
  // (contact's profile city). Apollo ANDs the two if both are present,
  // which would over-restrict. SHP cares about org location only.
  // Cap raised from 25 → 200 to fit our city-level location list (~166 cities
  // across 15 CFL North counties). Apollo's API doesn't document a hard cap
  // for this filter — 200 is well within tested working ranges.
  if (locations.length) payload.organization_locations = locations.slice(0, 200);
  if (orgKeywords.length) payload.q_organization_keyword_tags = orgKeywords.slice(0, 25);
  if (orgKeywordsExclude.length) payload.q_organization_not_keyword_tags = orgKeywordsExclude.slice(0, 25);

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
      // Apollo's free tier rejects search endpoints with a plain-text
      // "Invalid access credentials." body. Detect this specific failure
      // so the client can show actionable messaging instead of a generic
      // parse error.
      if (/invalid access credentials/i.test(text)) {
        return res.status(403).json({
          error: 'apollo_plan_required',
          message: 'Apollo people-search is a paid-plan feature. Your current API key works for enrichment but not discovery.',
          raw: text.slice(0, 200),
        });
      }
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
