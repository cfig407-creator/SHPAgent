// Vercel serverless function: proxies Apollo's mixed_companies/search endpoint
// for net-new account discovery in the user's ICP and territory.
//
// Like apollo-people-search, this is FREE — Apollo's search endpoints don't
// burn credits. Credits are only spent when you call the people/match enrich
// endpoint to get a verified email.
//
// Endpoint: POST /api/apollo-org-search
// Body: {
//   keywords?: string[],         // free-form keywords (e.g. "school district")
//   industries?: string[],       // Apollo industry strings
//   locations?: string[],        // city/state/country strings — "Florida, USA"
//   employeeRanges?: string[],   // "1,10" | "11,50" | "51,200" | "201,500" | "501,1000" | "1001,5000" etc
//   keywordsExclude?: string[],  // negative filters (e.g. "hospital", "medical")
//   limit?: number,              // default 25, max 100
//   page?: number,               // default 1
// }
// Returns: { organizations: [{ apolloId, name, website, domain, industry, city, state, country, foundedYear, estimatedEmployees, linkedinUrl, logoUrl, shortDescription }] }

export default async function handler(req, res) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'APOLLO_API_KEY not set in Vercel env vars' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const {
    keywords = [],
    industries = [],
    locations = [],
    employeeRanges = [],
    keywordsExclude = [],
    limit = 25,
    page = 1,
  } = req.body || {};

  if (
    (!Array.isArray(keywords) || keywords.length === 0) &&
    (!Array.isArray(industries) || industries.length === 0)
  ) {
    return res.status(400).json({
      error: 'Provide at least one keyword or industry filter',
      hint: '{ keywords: ["school district"] } or { industries: ["primary/secondary education"] }',
    });
  }

  // Apollo's mixed_companies/search request shape. Apollo accepts arrays for
  // most filters; sane defaults below mirror what their UI sends.
  const payload = {
    page,
    per_page: Math.min(Math.max(limit, 1), 100),
  };
  if (keywords.length) payload.q_organization_keyword_tags = keywords.slice(0, 25);
  if (keywordsExclude.length) payload.q_organization_not_keyword_tags = keywordsExclude.slice(0, 25);
  if (industries.length) payload.organization_industry_tag_ids = industries.slice(0, 25);
  // Cap raised to 200 to fit our city-level location list.
  if (locations.length) payload.organization_locations = locations.slice(0, 200);
  if (employeeRanges.length) payload.organization_num_employees_ranges = employeeRanges.slice(0, 10);

  try {
    const apolloResp = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
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
      // "Invalid access credentials." body. Surface a typed error so the
      // client can pivot to the CSV import flow.
      if (/invalid access credentials/i.test(text)) {
        return res.status(403).json({
          error: 'apollo_plan_required',
          message: 'Apollo organization-search is a paid-plan feature. Your current API key works for enrichment but not discovery.',
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

    // Apollo returns either `organizations` or `accounts` depending on plan.
    const list = Array.isArray(data?.organizations) ? data.organizations
              : Array.isArray(data?.accounts) ? data.accounts
              : [];

    const orgs = list.map(o => ({
      apolloId: o.id,
      name: o.name,
      website: o.website_url || o.primary_domain,
      domain: o.primary_domain,
      industry: o.industry,
      city: o.city,
      state: o.state,
      country: o.country,
      foundedYear: o.founded_year,
      estimatedEmployees: o.estimated_num_employees,
      linkedinUrl: o.linkedin_url,
      logoUrl: o.logo_url,
      shortDescription: o.short_description || o.description,
      keywords: Array.isArray(o.keywords) ? o.keywords.slice(0, 12) : [],
    })).filter(o => o.name);

    return res.status(200).json({
      organizations: orgs,
      totalEntries: data.pagination?.total_entries ?? orgs.length,
      page: data.pagination?.page ?? page,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Apollo org-search proxy failed',
      message: err.message,
    });
  }
}
