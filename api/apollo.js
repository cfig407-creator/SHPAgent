// Consolidated Apollo proxy — routes 4 sub-actions through ONE serverless
// function so we stay under Vercel Hobby's 12-function cap.
//
// All sub-handlers share the same env var (APOLLO_API_KEY) and the same
// base auth pattern (x-api-key header), so collapsing them costs nothing
// behaviorally — same logic, one entry point.
//
// Route by ?action= query parameter:
//   ?action=enrich         → POST body { firstName, lastName, name, organizationName, domain, email }
//                            Apollo people/match — 1 credit per match
//   ?action=people-search  → POST body { organizationName, titles[], locations[], orgKeywords[], ... }
//                            Apollo mixed_people/search — free, no credits
//   ?action=org-search     → POST body { keywords[], industries[], locations[], ... }
//                            Apollo mixed_companies/search — free, no credits
//   ?action=quota          → GET   — current credit usage from auth/health

export default async function handler(req, res) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'APOLLO_API_KEY not set in Vercel environment variables',
    });
  }

  const action = (req.query?.action || '').toString();

  try {
    if (action === 'enrich') return enrich(req, res, apiKey);
    if (action === 'people-search') return peopleSearch(req, res, apiKey);
    if (action === 'org-search') return orgSearch(req, res, apiKey);
    if (action === 'quota') return quota(req, res, apiKey);
    return res.status(400).json({ error: 'Unknown action', hint: 'Use ?action=enrich|people-search|org-search|quota' });
  } catch (err) {
    return res.status(500).json({ error: 'Apollo proxy failed', message: err.message });
  }
}

// ─── ENRICH (people/match) ──────────────────────────────────────────────
async function enrich(req, res, apiKey) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { firstName, lastName, name, organizationName, domain, email } = req.body || {};
  if (!name && !(firstName && lastName)) {
    return res.status(400).json({ error: 'Provide name or firstName+lastName' });
  }

  const payload = {};
  if (name) payload.name = name;
  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (organizationName) payload.organization_name = organizationName;
  if (domain) payload.domain = domain;
  if (email) payload.email = email;

  const r = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch { return res.status(r.status).json({ error: 'Apollo returned non-JSON', raw: text, status: r.status }); }

  if (!r.ok) return res.status(r.status).json({ error: data.error || data.message || 'Apollo API error', details: data });

  const person = data.person;
  if (!person) return res.status(200).json({ matched: false, message: 'No match found in Apollo database' });

  return res.status(200).json({
    matched: true,
    person: {
      id: person.id,
      firstName: person.first_name,
      lastName: person.last_name,
      name: person.name,
      title: person.title,
      email: person.email,
      emailStatus: person.email_status,
      linkedinUrl: person.linkedin_url,
      organizationName: person.organization?.name,
      organizationDomain: person.organization?.primary_domain || person.organization?.website_url,
      phone: person.phone_numbers?.[0]?.sanitized_number || null,
      photoUrl: person.photo_url,
    },
  });
}

// ─── PEOPLE SEARCH (mixed_people/search) ────────────────────────────────
async function peopleSearch(req, res, apiKey) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    organizationName,
    titles = [],
    locations = [],
    orgKeywords = [],
    orgKeywordsExclude = [],
    emailRequired = true,
    limit = 10,
    page = 1,
  } = req.body || {};

  if (!Array.isArray(titles) || titles.length === 0) {
    return res.status(400).json({ error: 'titles[] required' });
  }

  const payload = {
    person_titles: titles.slice(0, 25),
    page,
    per_page: Math.min(Math.max(limit, 1), 25),
  };
  if (organizationName) payload.q_organization_name = organizationName;
  if (locations.length) payload.organization_locations = locations.slice(0, 200);
  if (orgKeywords.length) payload.q_organization_keyword_tags = orgKeywords.slice(0, 25);
  if (orgKeywordsExclude.length) payload.q_organization_not_keyword_tags = orgKeywordsExclude.slice(0, 25);
  if (emailRequired) {
    payload.contact_email_status = ['verified', 'extrapolated_verified', 'likely_to_engage'];
  }

  const r = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    if (/invalid access credentials/i.test(text)) {
      return res.status(403).json({
        error: 'apollo_plan_required',
        message: 'Apollo people-search is a paid-plan feature.',
        raw: text.slice(0, 200),
      });
    }
    return res.status(r.status).json({ error: 'Apollo returned non-JSON', raw: text.slice(0, 500) });
  }
  if (!r.ok) return res.status(r.status).json({ error: data?.error || data?.message || 'Apollo search failed', details: data });

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
    email: p.email || '',
    emailStatus: p.email_status || null,
  })).filter(c => c.name);

  return res.status(200).json({
    candidates,
    totalEntries: data.pagination?.total_entries ?? candidates.length,
  });
}

// ─── ORG SEARCH (mixed_companies/search) ────────────────────────────────
async function orgSearch(req, res, apiKey) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    keywords = [],
    industries = [],
    locations = [],
    employeeRanges = [],
    keywordsExclude = [],
    limit = 25,
    page = 1,
  } = req.body || {};

  if ((!Array.isArray(keywords) || keywords.length === 0) &&
      (!Array.isArray(industries) || industries.length === 0)) {
    return res.status(400).json({ error: 'Provide at least one keyword or industry filter' });
  }

  const payload = {
    page,
    per_page: Math.min(Math.max(limit, 1), 100),
  };
  if (keywords.length) payload.q_organization_keyword_tags = keywords.slice(0, 25);
  if (keywordsExclude.length) payload.q_organization_not_keyword_tags = keywordsExclude.slice(0, 25);
  if (industries.length) payload.organization_industry_tag_ids = industries.slice(0, 25);
  if (locations.length) payload.organization_locations = locations.slice(0, 200);
  if (employeeRanges.length) payload.organization_num_employees_ranges = employeeRanges.slice(0, 10);

  const r = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    if (/invalid access credentials/i.test(text)) {
      return res.status(403).json({
        error: 'apollo_plan_required',
        message: 'Apollo organization-search is a paid-plan feature.',
        raw: text.slice(0, 200),
      });
    }
    return res.status(r.status).json({ error: 'Apollo returned non-JSON', raw: text.slice(0, 500) });
  }
  if (!r.ok) return res.status(r.status).json({ error: data?.error || data?.message || 'Apollo search failed', details: data });

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
}

// ─── QUOTA (auth/health) ────────────────────────────────────────────────
async function quota(req, res, apiKey) {
  const r = await fetch('https://api.apollo.io/api/v1/auth/health', {
    method: 'GET',
    headers: { 'Cache-Control': 'no-cache', 'x-api-key': apiKey },
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  const headerUsed = parseInt(r.headers.get('x-rate-limit-credit-used') || '', 10);
  const headerLimit = parseInt(r.headers.get('x-rate-limit-credit-limit') || '', 10);

  const creditsUsed = Number.isFinite(headerUsed) ? headerUsed
    : data?.credits_used ?? data?.usage?.used ?? null;
  const creditsTotal = Number.isFinite(headerLimit) ? headerLimit
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
}
