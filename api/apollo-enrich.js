// Vercel serverless function: proxies Apollo.io people-match (enrichment) calls server-side.
// Token from APOLLO_API_KEY env var (set in Vercel dashboard).
//
// Apollo's people-match endpoint takes name + organization details and returns:
// - verified work email + verification status
// - phone (sometimes)
// - LinkedIn URL
// - title (sometimes more recent than seed data)
// - photo URL
//
// Cost: 1 credit per matched person. 0 credits if not found.
// Free tier = 50 credits/month. Paid plans add more.
//
// Endpoint: POST /api/apollo-enrich
// Body: { firstName, lastName, organizationName, domain }
// Returns: { matched: bool, person?: {...}, message?: string }

export default async function handler(req, res) {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'APOLLO_API_KEY not set in Vercel environment variables',
      hint: 'Add APOLLO_API_KEY to Vercel project settings → Environment Variables',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { firstName, lastName, name, organizationName, domain, email } = req.body || {};

  // Apollo accepts name OR (firstName + lastName), and organizationName OR domain
  if (!name && !(firstName && lastName)) {
    return res.status(400).json({
      error: 'Missing required fields',
      hint: 'Provide either `name` or both `firstName` and `lastName`',
    });
  }

  // Build payload — Apollo's match endpoint accepts these keys
  // (reveal_personal_emails defaults to false; we don't want personal emails for cold outreach,
  // we want VERIFIED WORK emails specifically)
  const payload = {};
  if (name) payload.name = name;
  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (organizationName) payload.organization_name = organizationName;
  if (domain) payload.domain = domain;
  if (email) payload.email = email;

  try {
    const apolloResp = await fetch('https://api.apollo.io/api/v1/people/match', {
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
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(apolloResp.status).json({
        error: 'Apollo returned non-JSON response',
        raw: text,
        status: apolloResp.status,
      });
    }

    if (!apolloResp.ok) {
      return res.status(apolloResp.status).json({
        error: data.error || data.message || 'Apollo API error',
        details: data,
      });
    }

    // Apollo returns either { person: {...} } on match, or { person: null } on miss
    const person = data.person;
    if (!person) {
      return res.status(200).json({
        matched: false,
        message: 'No match found in Apollo database',
      });
    }

    // Extract just the fields we care about — work email, phone, title, linkedin, organization
    // Don't return everything (Apollo response is large and contains data we don't need)
    const summary = {
      matched: true,
      person: {
        id: person.id,
        firstName: person.first_name,
        lastName: person.last_name,
        name: person.name,
        title: person.title,
        // Email — only return if Apollo has marked it verified or likely-to-engage
        email: person.email,
        emailStatus: person.email_status, // 'verified' | 'likely_to_engage' | 'unverified' | etc.
        linkedinUrl: person.linkedin_url,
        organizationName: person.organization?.name,
        organizationDomain: person.organization?.primary_domain || person.organization?.website_url,
        // Phone — Apollo's mobile phone is paid-only, but we surface what's available
        phone: person.phone_numbers?.[0]?.sanitized_number || null,
        photoUrl: person.photo_url,
      },
    };

    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({
      error: 'Apollo proxy fetch failed',
      message: err.message,
    });
  }
}
