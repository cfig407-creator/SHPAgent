// Outbound Agent — Strategy Module v3
// Engine code — vertical-agnostic logic that reads tenant-specific data
// from the active business profile. Per-tenant content (identity, voice,
// territory, customers) lives in ./profiles/{tenantId}.js — see
// ./profiles/index.js for the selector.
//
// PR1 scope: identity + defaults are now profile-sourced. Voice, territory,
// ICP, and customer banks still live inline below and migrate in PR2.

import profile from './profiles/index.js';

// Re-export the tenant identity under the historical SHP_IDENTITY name so
// the rest of the codebase doesn't need to change. Future PRs can rename
// to BUSINESS_IDENTITY once we're confident the profile system is stable.
export const SHP_IDENTITY = profile.identity;

// Default email signature, CAN-SPAM-compliant (15 U.S.C. 7704 requires a
// valid physical postal address in every commercial email). The profile
// is responsible for keeping the address in its signature template.
export const DEFAULT_SIGNATURE = profile.defaults.signature;

// Soft opt-out line — included in cold emails so recipients can decline
// without filing a spam complaint (which damages domain reputation).
export const DEFAULT_SOFT_OPT_OUT = profile.defaults.softOptOut;

// Touch-cap — stop emailing after this many sends with no reply unless
// the user explicitly overrides. Guards against harassment complaints.
export const DEFAULT_MAX_TOUCHES = profile.defaults.maxTouches;

// Brand surface for the UI shell (header text, logo letters, primary color).
// Read by OutboundAgent.jsx for the top-of-page chrome.
export const BUSINESS_BRAND = profile.brand;

// === CUSTOMER PROOF POINTS ===
// Curated from invoice data. named=true means OK to drop the name in cold email body.
// Profile owns the data; engine pulls them via re-export for backward compat.
export const CUSTOMERS = profile.customers;

// Pick proof points for an email. Logic: prefer same-county or same-segment, take 2-3 names total.
// Falls back to top revenue when no segment/county match.
export function pickProofPoints(prospect, max = 3) {
  if (!prospect) return [];
  const eligible = CUSTOMERS.filter(c => c.named);
  // Score by relevance to this prospect
  const scored = eligible.map(c => {
    let score = 0;
    if (prospect.county && c.county === prospect.county) score += 100;
    if (prospect.segment && c.segment === prospect.segment) score += 50;
    // Also good: same broad type (Local Gov + K-12 are both public-sector)
    if ((prospect.segment === 'Local Government' || prospect.segment === 'K-12 Education' || prospect.segment === 'Higher Education')
        && (c.segment === 'Local Government' || c.segment === 'K-12 Education' || c.segment === 'Higher Education')) {
      score += 20;
    }
    score += Math.log10(c.revenue + 10); // small revenue weighting
    return { ...c, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

// === CUSTOMER COLLISION CHECK ===
// Detects when a prospect's organization matches an existing SHP customer, so we can
// auto-tag them as 'Customer' status (preventing accidental cold emails to active accounts).
//
// Returns: 'match' (high confidence), 'likely-match' (probable but flag for review), or 'no-match'.
// Match logic uses normalized org-name comparison — handles common variations like
// "Stetson" vs "Stetson University", "City of Deland" vs "Deland", etc.
export function customerCheck(prospect) {
  if (!prospect?.company) return { result: 'no-match', matchedCustomer: null };
  const prospectOrg = normalizeOrgName(prospect.company);
  if (!prospectOrg) return { result: 'no-match', matchedCustomer: null };

  // Score each customer for similarity against the prospect's org
  let bestMatch = null;
  let bestScore = 0;
  for (const customer of CUSTOMERS) {
    const customerOrg = normalizeOrgName(customer.name);
    const score = orgNameSimilarity(prospectOrg, customerOrg);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = customer;
    }
  }

  // High threshold (>=0.85) = confident match
  // Medium threshold (>=0.65) = likely match, flag for human review
  // Below = no match
  if (bestScore >= 0.85) return { result: 'match', matchedCustomer: bestMatch, score: bestScore };
  if (bestScore >= 0.65) return { result: 'likely-match', matchedCustomer: bestMatch, score: bestScore };
  return { result: 'no-match', matchedCustomer: null, score: bestScore };
}

// Normalize an organization name for comparison: lowercase, strip punctuation, drop common
// noise words ("the", "inc", "llc", "corp", "company", "co"), collapse whitespace.
function normalizeOrgName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,'"()&]/g, ' ')
    .replace(/\b(the|inc|llc|corp|corporation|company|co|ltd|limited|pllc|pa)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Org similarity score (0-1) using token-set overlap with substring boost.
// Accounts for: word reordering, missing words, plurals, common abbreviations.
function orgNameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Strip generic geographic/institutional words that cause false positives
  // ("Florida", "State", "Public", "Schools", "County", "City", etc. are too common
  // to be meaningful alone — they're place/category labels, not distinguishing identity)
  const GENERIC_WORDS = /\b(florida|state|public|schools?|college|university|agricultural|mechanical|academy|institute|center|services|department|district|county|city|town|village|board|government|administration)\b/g;
  const aDistinctive = a.replace(GENERIC_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const bDistinctive = b.replace(GENERIC_WORDS, ' ').replace(/\s+/g, ' ').trim();

  // Substring match — only if the distinctive part is at least 2 words OR a long single word.
  // Prevents short single-word matches like "daytona" matching across unrelated orgs.
  const aHasMultipleWords = aDistinctive.split(' ').length >= 2 || aDistinctive.length >= 8;
  const bHasMultipleWords = bDistinctive.split(' ').length >= 2 || bDistinctive.length >= 8;
  if (aHasMultipleWords && aDistinctive.length >= 6 && b.includes(aDistinctive)) return 0.9;
  if (bHasMultipleWords && bDistinctive.length >= 6 && a.includes(bDistinctive)) return 0.9;

  // Token-set overlap on the DISTINCTIVE tokens only
  const aTokens = new Set(aDistinctive.split(' ').filter(t => t.length >= 3));
  const bTokens = new Set(bDistinctive.split(' ').filter(t => t.length >= 3));
  if (aTokens.size === 0 || bTokens.size === 0) {
    // Both orgs are entirely generic words — fall back to full-string token comparison
    const aFullTokens = new Set(a.split(' ').filter(t => t.length >= 3));
    const bFullTokens = new Set(b.split(' ').filter(t => t.length >= 3));
    if (aFullTokens.size === 0 || bFullTokens.size === 0) return 0;
    const fullIntersection = [...aFullTokens].filter(t => bFullTokens.has(t)).length;
    const fullUnion = new Set([...aFullTokens, ...bFullTokens]).size;
    return fullIntersection / fullUnion;
  }

  const intersection = [...aTokens].filter(t => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = intersection / union;

  // If all DISTINCTIVE tokens of the smaller set are present in the larger, boost score —
  // BUT only when the smaller set has 2+ distinctive tokens. Single-token "matches" are too weak
  // (e.g., UCF and Orlando Health both have "central" — that doesn't make them the same org).
  const smaller = aTokens.size <= bTokens.size ? aTokens : bTokens;
  const larger = aTokens.size <= bTokens.size ? bTokens : aTokens;
  const allPresent = [...smaller].every(t => larger.has(t));
  if (allPresent && smaller.size >= 2) return Math.max(jaccard, 0.85);

  return jaccard;
}

// === ENRICHMENT DETECTION ===
// Identifies prospects with data quality issues that block cold outreach.
// Returns { needsEnrichment: bool, reasons: [string] } so the UI can surface what's wrong.
//
// Rules (each returns a reason string when triggered):
// - Missing email entirely
// - Personal email domain (gmail/yahoo/etc.) when org clearly has a domain
// - Generic role inbox (registrar@, info@, admin@) when contact is a specific person
// - Email name doesn't match contact name (different person's email attached to record)
// - Title indicates non-buyer (student, intern, alumnus, retired)
const PERSONAL_DOMAINS = /(gmail|yahoo|hotmail|outlook\.com|aol|icloud|live\.com|me\.com|comcast|att\.net|verizon|sbcglobal|earthlink)/i;
const GENERIC_INBOXES = /^(info|admin|contact|office|registrar|hello|help|support|inquiries|main|reception|frontdesk|hr|noreply)@/i;
const NON_BUYER_TITLES = /\b(student|intern|alumnus|alumna|retired|former|emeritus|volunteer)\b/i;

export function detectEnrichmentNeeds(prospect) {
  const reasons = [];
  if (!prospect) return { needsEnrichment: false, reasons };

  // 1. Missing email
  if (!prospect.email || !prospect.email.includes('@')) {
    reasons.push('Missing email');
  } else {
    // 2. Personal email when org has a likely domain
    if (PERSONAL_DOMAINS.test(prospect.email)) {
      // Only flag if org name suggests they should have a work domain
      // (cities, schools, colleges, government bodies almost always do)
      const orgLower = (prospect.company || '').toLowerCase();
      const orgHasObviousDomain = /\b(city|county|college|university|school|district|government|board|public|department|state|federal|authority|district)\b/.test(orgLower);
      if (orgHasObviousDomain) {
        reasons.push('Personal email at org with public domain');
      }
    }

    // 3. Generic role inbox attached to a specific person
    if (GENERIC_INBOXES.test(prospect.email) && prospect.name && prospect.name.split(' ').length >= 2) {
      reasons.push('Role inbox (not personal mailbox)');
    }

    // 4. Email name doesn't match contact name
    // Heuristic: extract the local-part initials and compare to contact's initials
    const emailLocal = prospect.email.split('@')[0].toLowerCase();
    const contactName = (prospect.name || '').toLowerCase();
    if (contactName && emailLocal && !PERSONAL_DOMAINS.test(prospect.email) && !GENERIC_INBOXES.test(prospect.email)) {
      const contactTokens = contactName.split(/[\s.]+/).filter(t => t.length >= 2);
      // Check if any contact name token appears in the email local-part
      const anyTokenInEmail = contactTokens.some(t => emailLocal.includes(t));
      // Reverse check: if email looks like firstname.lastname or flastname format
      if (!anyTokenInEmail && contactTokens.length >= 2 && emailLocal.length >= 3) {
        reasons.push('Email may belong to a different person');
      }
    }
  }

  // 5. Non-buyer title
  if (prospect.title && NON_BUYER_TITLES.test(prospect.title)) {
    reasons.push(`Non-buyer title (${prospect.title})`);
  }

  // 6. Missing name
  if (!prospect.name || prospect.name.trim().length < 2) {
    reasons.push('Missing contact name');
  }

  return {
    needsEnrichment: reasons.length > 0,
    reasons,
  };
}

// === VOICE CONTENT (re-exports from profile) ===
// All cold-email tone, structure, banks, and example templates now live in
// the active business profile. Engine just exposes them under historical
// names for backward compat with SHPProspectingAgent.jsx and composeEmail.
export const VOICE_EXAMPLES   = profile.voice.examples;
export const VOICE_GUIDE      = profile.voice.guide;
export const OPENER_BANK      = profile.voice.openerBank;
export const BODY_BANK        = profile.voice.bodyBank;
export const CTA_BANK         = profile.voice.ctaBank;
export const FULL_EMAIL_BANK  = profile.voice.fullEmailBank;
export const SUBJECT_BANK     = profile.voice.subjectBank;

// === EM-DASH SCRUBBER ===
// Removes em (—) and en (–) dashes from prospect-facing text. Em dashes are a
// well-known AI tell and we don't want them in any outbound writing — replace
// them with comma+space which reads naturally in 99% of contexts.
// Applied to: cold email subject/body, follow-up emails, LinkedIn message,
// subject alternatives, and the deterministic fallback composer output.
export function stripEmDashes(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\s*—\s*/g, ', ')   // em dash with any surrounding whitespace
    .replace(/\s*–\s*/g, ', ')   // en dash with any surrounding whitespace
    .replace(/, +\n/g, ',\n')    // clean trailing space before newline
    .replace(/, ,/g, ',')        // collapse accidental doubled commas
    .replace(/ , /g, ', ')       // normalize spacing
    .replace(/  +/g, ' ');       // collapse runs of spaces
}

// === GRAMMAR NORMALIZER ===
// Claude keeps "fixing" plural phrases back to singular in soft opt-outs
// (e.g., "doors and hardware aren't" → "door and hardware isn't") because
// the singular reads as a compound noun in some patterns. This applies
// targeted regex rewrites to lock the plural form everywhere it shows up.
// Run alongside stripEmDashes on every prospect-facing string.
export function normalizeGrammar(text) {
  if (typeof text !== 'string') return text;
  return text
    // "If door & hardware isn't" → "If doors and hardware aren't"
    .replace(/\bdoor\s*&\s*hardware\s+isn'?t\b/gi, "doors and hardware aren't")
    .replace(/\bdoor\s+and\s+hardware\s+isn'?t\b/gi, "doors and hardware aren't")
    // Catch the plural noun + singular verb mistake: "doors and hardware isn't"
    .replace(/\bdoors\s+and\s+hardware\s+isn'?t\b/gi, "doors and hardware aren't")
    // "If door & hardware is/are" — normalize the "is" form too
    .replace(/\bdoor\s*&\s*hardware\s+is\b/gi, 'doors and hardware are')
    .replace(/\bdoor\s+and\s+hardware\s+is\b/gi, 'doors and hardware are')
    // The "& " → "and " in opt-out context (rare, but Claude sometimes copies it)
    .replace(/\bdoor\s*&\s*hardware\b/gi, 'doors and hardware');
}

// Run both cleaners. Convenience wrapper for the call sites that apply both.
export function cleanProspectText(text) {
  return normalizeGrammar(stripEmDashes(text));
}

// === COMPOSER ===
// Picks pieces from each bank based on prospect context, fills placeholders,
// returns a complete email. Pure JavaScript — no API calls.
//
// Tracks recently-picked variants in a session-level memory to avoid repeating
// (the composer takes an `avoid` array of variant IDs).
export function composeEmail({ prospect, signature, proofPoints = [], avoid = [], softOptOut = DEFAULT_SOFT_OPT_OUT }) {
  // === CONTEXT FLAGS ===
  // What's true about this prospect that affects variant selection?
  const ctx = {
    sameCountyCustomer: proofPoints.some(p => p.county === prospect.county),
    hasProofPoints: proofPoints.length > 0,
    strategicTitle: ['director', 'vp', 'vice president', 'head of', 'chief',
      'superintendent', 'cfo', 'coo', 'ceo', 'principal', 'business manager',
      'city manager', 'county administrator'].some(k =>
        (prospect.title || '').toLowerCase().includes(k)),
    inProximity: !!prospect.county, // For now, all CFL North prospects qualify; future: distance-aware
    hasExistingRelationship: false, // Future: lookup from Pipedrive
  };

  // === PICK SUBJECT ===
  const subjectTemplate = SUBJECT_BANK[Math.floor(Math.random() * SUBJECT_BANK.length)];

  // === FILL PLACEHOLDERS ===
  const firstName = (prospect.name || '').split(' ')[0] || 'there';
  const greetingName = firstName !== 'there' ? firstName : 'there';

  // Build proof drop sentence (used inside body when {proof} placeholder is present)
  const proofDrop = buildProofDrop(proofPoints, prospect);

  const fillVars = {
    company: prospect.company || 'your team',
    county: prospect.county || 'the area',
    firstName: greetingName,
    proof: proofDrop,
    proofList: buildProofList(proofPoints),
  };

  const subject = fillTemplate(subjectTemplate, fillVars);
  const optOutLine = softOptOut ? `\n\n${softOptOut}` : '';

  // === TRY FULL EMAIL BANK FIRST ===
  // These are pre-written 2–3 paragraph emails that flow naturally as a unit.
  // Much better than the 3-part assembly for voice consistency.
  const fullVariant = pickVariant(FULL_EMAIL_BANK, ctx, avoid);
  if (fullVariant) {
    const fullEmailText = fillTemplate(fullVariant.text, fillVars);
    const fullBody = `Hi ${greetingName},

${fullEmailText}${optOutLine}

Best,

${signature || DEFAULT_SIGNATURE}`;

    return {
      subject: cleanProspectText(subject),
      body: cleanProspectText(fullBody),
      diagnostic: {
        composer: 'deterministic',
        variantId: fullVariant.id,
        openerId: null,
        bodyId: null,
        ctaId: null,
        subjectTemplate,
        proofPointsUsed: proofPoints.map(p => p.name),
        contextFlags: ctx,
      },
    };
  }

  // === FALLBACK: 3-PART ASSEMBLY ===
  // Used only when no FULL_EMAIL_BANK variant matches context after avoid filtering.
  const opener = pickVariant(OPENER_BANK, ctx, avoid) || OPENER_BANK[0];
  const body = pickVariant(BODY_BANK, ctx, avoid) || BODY_BANK[0];
  const cta = pickVariant(CTA_BANK, ctx, avoid) || CTA_BANK[0];

  const openerText = fillTemplate(opener.text, fillVars);
  const bodyText = fillTemplate(body.text, fillVars);
  const ctaText = fillTemplate(cta.text, fillVars);

  // Soft opt-out always appears as its own paragraph between the CTA and the
  // sign-off so recipients can decline without filing a spam complaint.
  const fullBody = `Hi ${greetingName},

${openerText}

${bodyText}

${ctaText}${optOutLine}

Best,

${signature || DEFAULT_SIGNATURE}`;

  return {
    subject: stripEmDashes(subject),
    body: stripEmDashes(fullBody),
    diagnostic: {
      composer: 'deterministic',
      openerId: opener.id,
      bodyId: body.id,
      ctaId: cta.id,
      subjectTemplate,
      proofPointsUsed: proofPoints.map(p => p.name),
      contextFlags: ctx,
    },
  };
}

// Pick a variant whose `requires` (if any) match the context, excluding any in `avoid`.
// Also respects `avoidWhen` flags — variants are skipped when any avoidWhen flag is true in context.
function pickVariant(bank, ctx, avoid) {
  const eligible = bank.filter(v => {
    if (avoid.includes(v.id)) return false;
    if (v.avoidWhen && v.avoidWhen.some(flag => ctx[flag])) return false;
    if (!v.requires) return true;
    return v.requires.every(req => ctx[req]);
  });
  if (eligible.length === 0) {
    // Fall back to bank without requires & without avoidWhen flags hitting — the universal default
    const fallback = bank.filter(v =>
      !v.requires && !avoid.includes(v.id) && (!v.avoidWhen || !v.avoidWhen.some(flag => ctx[flag]))
    );
    if (fallback.length > 0) {
      return fallback[Math.floor(Math.random() * fallback.length)];
    }
    // Last resort: anything not in avoid
    const anyNonAvoided = bank.filter(v => !avoid.includes(v.id));
    if (anyNonAvoided.length > 0) {
      return anyNonAvoided[Math.floor(Math.random() * anyNonAvoided.length)];
    }
    return null;
  }
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// Build a natural-sounding proof drop sentence: " We currently support X and Y in the area, among others."
// Returns empty string when no proofs (so {proof} placeholder cleanly disappears).
function buildProofDrop(proofPoints, prospect) {
  if (!proofPoints || proofPoints.length === 0) return '';
  const names = proofPoints.slice(0, 2).map(p => p.name);
  if (names.length === 1) {
    return ` We currently support ${names[0]} in the area, among others.`;
  }
  return ` We currently support ${names[0]} and ${names[1]} in the area, among others.`;
}

// Build proof list for {proofList} placeholder used in body B2: "X, Y, and Z"
function buildProofList(proofPoints) {
  if (!proofPoints || proofPoints.length === 0) return 'multiple partners';
  const names = proofPoints.slice(0, 3).map(p => p.name);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]}, and ${names[2]}`;
}

// Replace {placeholder} tokens in a template string.
function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, key) => vars[key] !== undefined ? vars[key] : m);
}


export const TERRITORY = profile.territory;

// County-level location strings — kept for reference. Apollo's county
// geocoder is unreliable on free tier (leaks results from other states),
// so we use city-level strings (below, after CITY_TO_COUNTY) instead.
export const APOLLO_COUNTY_LOCATION_STRINGS = TERRITORY.counties.map(
  c => `${c} County, Florida, US`
);

// ZIP → county map for the 15 CFL North counties. Used as a fallback in
// classifyCounty when a CSV row has a zip but no recognizable city, and
// also exposed for any downstream features that need zip-based territory
// validation (lead-routing, etc.).
// Coverage strategy: every USPS zip primarily associated with each county
// (including small towns and CDPs), not just county-seat zips. ~350
// entries total. Built from USPS county-zip cross-reference data.
export const ZIP_TO_COUNTY = profile.zipToCounty;

// City → County map for territory classification
export const CITY_TO_COUNTY = profile.cityToCounty;

// Apollo city-level location strings — built from CITY_TO_COUNTY.
// Apollo's city geocoder is reliable: "Jacksonville, Florida, US" matches
// Jacksonville, FL specifically (not Jacksonville, NC or similar). This
// fixes the over-broad results we got with county-level strings, which
// Apollo geocodes loosely on the free tier.
//
// Title-cases the city name and appends ", Florida, US". Apollo accepts
// up to dozens of organizationLocations[] entries in a single search.
export const APOLLO_CITY_LOCATION_STRINGS = (() => {
  const titleCase = (s) => s.split(' ').map(w => {
    if (!w) return w;
    if (w.toLowerCase() === 'st.' || w.toLowerCase() === 'st') return 'St.';
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
  // De-dupe (multiple keys may share a title-cased form) and emit Apollo-shaped strings.
  const seen = new Set();
  const out = [];
  for (const key of Object.keys(CITY_TO_COUNTY)) {
    const city = titleCase(key);
    if (seen.has(city)) continue;
    seen.add(city);
    out.push(`${city}, Florida, US`);
  }
  return out;
})();

// Primary export used by the agent. City-level by default — tightest match.
export const APOLLO_LOCATION_STRINGS = APOLLO_CITY_LOCATION_STRINGS;

// classifyCounty: derive a CFL North county from a city name. Accepts an
// optional zip-code fallback so CSV imports with sparse city data still
// route correctly. Pass the prospect's full zip; we use the 5-digit
// prefix for the lookup.
export function classifyCounty(city, zip) {
  if (city) {
    const hit = CITY_TO_COUNTY[String(city).trim().toLowerCase()];
    if (hit) return hit;
  }
  if (zip) {
    const z = String(zip).trim().slice(0, 5);
    if (ZIP_TO_COUNTY[z]) return ZIP_TO_COUNTY[z];
  }
  return null;
}

export function isInTerritory(city, county) {
  if (county && TERRITORY.counties.includes(county)) return true;
  return classifyCounty(city) !== null;
}

// === ICP DETECTION ===
const HEALTHCARE_KW = ['hospital', 'medical center', 'health system', 'orthopedic',
  'pediatric', 'mayo clinic', 'baptist medical', 'orlando health', 'adventhealth',
  'ascension', 'va medical', 'memorial hospital', 'physicians group', 'medical group',
  // Major regional healthcare orgs whose names don't include the obvious words above
  'nemours', 'borland groover', 'baptist health', 'flagler health',
  'ucf health', 'central florida health', 'children\'s hospital',
  'healthcare', 'health care', 'urgent care', 'surgery center',
  'cancer center', 'rehabilitation hospital', 'rehab hospital'];
const INDUSTRIAL_KW = ['warehouse', 'manufacturing', 'industrial', 'logistics',
  'distribution center', 'plant', 'factory', 'fulfillment'];
const RETAIL_KW = ['retail', 'storefront', 'mall', 'outlet', 'shopping center'];
const RESIDENTIAL_KW = ['apartments', 'apartment complex', 'condominium', 'condos',
  'hoa', 'homeowners', 'multifamily', 'multi-family', 'residential', 'living community'];
const CRE_PM_KW = ['cbre', 'jll', 'cushman', 'colliers', 'newmark', 'transwestern',
  'commercial real estate', 'property management', 'realty partners',
  'highwoods', 'crocker partners', 'foundry commercial', 'tower realty', 'stiles property'];
const HOSPITALITY_KW = ['hotel', 'resort', 'hospitality', 'marriott', 'hilton',
  'hyatt', 'sheraton', 'westin', 'doubletree', 'embassy suites', 'four seasons',
  'ritz', 'country club', 'golf club', 'cruise'];
const K12_KW = ['school district', 'elementary', 'middle school', 'high school',
  'academy', 'christian school', 'lutheran school', 'catholic school',
  'preparatory', 'montessori', 'charter school', 'school of', 'private school',
  'isd', 'unified', 'public schools', 'county schools', 'k-12'];
const HIGHER_ED_KW = ['college', 'university', 'state college', 'community college',
  'embry-riddle', 'rollins', 'flagler college', 'daytona state', 'seminole state',
  'valencia', 'lake-sumter', 'st. johns river state', 'st johns river state',
  'institute of technology', 'polytechnic', 'school of medicine'];
const LOCAL_GOV_KW = ['city of', '(city)', 'county government', 'county boc',
  'county boa', 'county commission', 'town of', 'village of', 'utility',
  'utilities', 'public works', 'parks and recreation', 'parks & recreation',
  'sheriff', 'police department', 'fire department', 'fire rescue', 'court',
  'courthouse', 'county school', 'water management', 'transit authority',
  'department of'];

// ICP policy: HEALTHCARE is the only auto-exclusion. Every other commercial
// vertical (industrial, retail, residential, hospitality, CRE/PM, plus
// uncategorized "Commercial") is in-ICP — SHP supplies door & hardware to all
// of them. Segment is preserved for filtering/reporting; `status` drives
// whether the prospect appears in the Active pool.
export function classifyICP(company, title = '') {
  const text = `${company || ''} ${title || ''}`.toLowerCase();
  if (HEALTHCARE_KW.some(k => text.includes(k))) return { segment: 'Healthcare', status: 'out' };
  if (HIGHER_ED_KW.some(k => text.includes(k))) return { segment: 'Higher Education', status: 'in' };
  if (K12_KW.some(k => text.includes(k))) return { segment: 'K-12 Education', status: 'in' };
  if (LOCAL_GOV_KW.some(k => text.includes(k))) return { segment: 'Local Government', status: 'in' };
  if (INDUSTRIAL_KW.some(k => text.includes(k))) return { segment: 'Industrial', status: 'in' };
  if (RETAIL_KW.some(k => text.includes(k))) return { segment: 'Retail', status: 'in' };
  if (RESIDENTIAL_KW.some(k => text.includes(k))) return { segment: 'Residential', status: 'in' };
  if (HOSPITALITY_KW.some(k => text.includes(k))) return { segment: 'Hospitality', status: 'in' };
  if (CRE_PM_KW.some(k => text.includes(k))) return { segment: 'Multi-site CRE/PM', status: 'in' };
  return { segment: 'Commercial', status: 'in' };
}

// === TITLE ALTITUDE ===
const STRATEGIC_TITLES = ['director', 'vp', 'vice president', 'head of', 'chief',
  'cfo', 'coo', 'ceo', 'superintendent', 'head of school', 'business manager',
  'school business', 'city manager', 'county administrator', 'principal'];
const TACTICAL_TITLES = ['manager', 'coordinator', 'supervisor', 'lead',
  'maintenance', 'specialist', 'tech', 'technician'];
const FACILITIES_TITLES = ['facilit', 'maintenance', 'operations', 'physical plant',
  'public works', 'plant', 'buildings', 'grounds', 'campus services',
  'campus operations', 'property'];

export function classifyTitle(title) {
  if (!title) return { altitude: 'unknown', facilitiesRelevant: false };
  const t = title.toLowerCase();
  const isFac = FACILITIES_TITLES.some(k => t.includes(k));
  const isStrategic = STRATEGIC_TITLES.some(k => t.includes(k));
  const isTactical = TACTICAL_TITLES.some(k => t.includes(k));
  return {
    altitude: isStrategic ? 'strategic' : (isTactical ? 'tactical' : 'unknown'),
    facilitiesRelevant: isFac,
  };
}

// =====================================================================
// === MULTI-THREAD TITLE LADDER ========================================
// =====================================================================
// Used by the "Find peers at this org" feature: given an existing prospect's
// title, returns the set of titles to search for at the same organization
// (going up AND down the ladder, plus adjacent functions when at C-suite).
//
// Tiers (lowest → highest):
//   1 — Frontline   (Technician, Tradesperson, Maintenance Worker)
//   2 — Tactical    (Coordinator, Supervisor, Lead, Specialist)
//   3 — Management  (Manager, Senior Manager, Asst Director)
//   4 — Strategic   (Director, VP, Superintendent, Chief / President)
export const TITLE_LADDER = profile.icp.titleLadder;

// Adjacent functions worth multi-threading to when you have a C-suite contact —
// these touch door/hardware purchasing decisions even though they're not "facilities."
export const ADJACENT_FUNCTIONS = profile.icp.adjacentFunctions;

// === FACILITIES KEYWORD LIST — for broad multi-thread coverage ===
// Apollo's person_titles field is a fuzzy/token-based match. Submitting
// "Facilities" matches "Director of Facilities", "Facilities Manager",
// "Facilities Coordinator", "Senior Facilities Specialist", etc. — all in
// one slot. So instead of enumerating every possible title, we pass broad
// keywords that capture everyone with that token in their title.
//
// Coverage spans: core facilities/maintenance roles, plant operations
// (common at higher ed + manufacturing), physical plant (the term schools
// use), buildings & grounds (K-12 + universities), and adjacent functions
// that touch door/hardware purchasing (procurement, safety, security,
// capital projects, construction).
//
// Total: 18 keywords. Apollo's per-query cap is 25, so we have headroom.
export const FACILITIES_KEYWORDS = profile.icp.facilitiesKeywords;

// Returns the broad facilities-keyword list. Used by Find Peers and bulk
// cross-thread to capture every facilities-adjacent contact at an org,
// not just titles matching the curated TITLE_LADDER.
export function getFacilitiesSearchTitles() {
  return FACILITIES_KEYWORDS;
}

// === ORG NAME NORMALIZATION ===
// Org records come in many flavors of the same name: "Lake Mary Prep",
// "Lake Mary Preparatory School", "Lake Mary Preparatory School Inc."
// Lowercase+collapse-whitespace matching treats them as DIFFERENT orgs and
// breaks any cross-record reasoning (e.g. inferring an email pattern from
// one record's email when guessing for peers at the same school).
//
// normalizeOrgKey strips noise tokens (suffixes, articles, common modifiers
// like "Preparatory" / "Prep" / "School") and produces a canonical key by
// sorting the remaining significant tokens. Lake Mary variants all collapse
// to "lake|mary".
const ORG_NOISE_WORDS = new Set([
  'inc', 'llc', 'corp', 'corporation', 'company', 'co', 'ltd', 'the',
  'school', 'schools', 'preparatory', 'prep', 'academy',
  'district', 'county', 'city', 'town', 'village',
  'university', 'college', 'institute', 'center', 'centre',
  'department', 'dept', 'of', 'and',
]);

export function normalizeOrgKey(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !ORG_NOISE_WORDS.has(t))
    .sort()
    .join('|');
}

// === EMAIL PATTERN INFERENCE ===
// When Apollo gives us a first name only but the website has the full name,
// and we know at least one verified email at the same org, we can guess
// the missing person's email by reverse-engineering the org's pattern.
//
// Supported patterns (the 12 most common):
//   first, last, firstlast, first.last, flast, f.last, firstl, first.l,
//   first_last, lastfirst, last.first, lastf

// Normalize a name token: lowercase, strip non-alpha (apostrophes, hyphens).
function normalizeNameToken(s) {
  return (s || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Given a known name + verified email, infer the local-part pattern.
// Returns { pattern, domain } or null if no recognized pattern matches.
export function detectEmailPattern(name, email) {
  if (!name || !email || !email.includes('@')) return null;
  const [rawLocal, domain] = email.toLowerCase().trim().split('@');
  const local = rawLocal.split('+')[0]; // strip plus-aliases (jane+work@org → jane)
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = normalizeNameToken(parts[0]);
  const last = normalizeNameToken(parts[parts.length - 1]);
  if (!first || !last) return null;
  const fi = first[0];
  const li = last[0];

  if (local === first) return { pattern: 'first', domain };
  if (local === last) return { pattern: 'last', domain };
  if (local === first + last) return { pattern: 'firstlast', domain };
  if (local === first + '.' + last) return { pattern: 'first.last', domain };
  if (local === fi + last) return { pattern: 'flast', domain };
  if (local === fi + '.' + last) return { pattern: 'f.last', domain };
  if (local === first + li) return { pattern: 'firstl', domain };
  if (local === first + '.' + li) return { pattern: 'first.l', domain };
  if (local === first + '_' + last) return { pattern: 'first_last', domain };
  if (local === last + first) return { pattern: 'lastfirst', domain };
  if (local === last + '.' + first) return { pattern: 'last.first', domain };
  if (local === last + fi) return { pattern: 'lastf', domain };
  return null;
}

// Apply a detected pattern to a new name. Returns the generated email or null
// if the name can't be parsed into first/last.
export function applyEmailPattern(name, patternInfo) {
  if (!name || !patternInfo?.pattern || !patternInfo?.domain) return null;
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = normalizeNameToken(parts[0]);
  const last = normalizeNameToken(parts[parts.length - 1]);
  if (!first || !last) return null;
  const fi = first[0];
  const li = last[0];
  const builders = {
    'first': () => first,
    'last': () => last,
    'firstlast': () => first + last,
    'first.last': () => first + '.' + last,
    'flast': () => fi + last,
    'f.last': () => fi + '.' + last,
    'firstl': () => first + li,
    'first.l': () => first + '.' + li,
    'first_last': () => first + '_' + last,
    'lastfirst': () => last + first,
    'last.first': () => last + '.' + first,
    'lastf': () => last + fi,
  };
  const local = builders[patternInfo.pattern]?.();
  return local ? `${local}@${patternInfo.domain}` : null;
}

// Given a list of (name, email) examples at the same org, find the dominant
// pattern. Returns { pattern, domain, confidence, sampleCount }.
//
// Three strategies, in order:
//   1. Majority vote across the 12 standard patterns (firstlast, flast, etc.)
//   2. Heuristic detection of unusual patterns where local part starts with
//      first initial and ends with last name (e.g. "beryden" = b+?+ryden).
//      Returns 'flast' as the best guess we can offer at 0.4 confidence.
//   3. Pure fallback: if at least one example has a valid email, extract its
//      domain and return 'flast' at 0.3 confidence so the user gets SOMETHING
//      to verify. Better than nothing.
//
// Returns null only if no example has a parseable email at all.
export function inferEmailPatternFromExamples(examples) {
  if (!Array.isArray(examples)) examples = [];

  // Try standard pattern detection first
  const detected = examples
    .map(e => detectEmailPattern(e.name, e.email))
    .filter(Boolean);

  if (detected.length > 0) {
    // Count occurrences keyed by `pattern@domain`
    const counts = new Map();
    for (const d of detected) {
      const key = `${d.pattern}@${d.domain}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of counts.entries()) {
      if (count > bestCount) { bestKey = key; bestCount = count; }
    }
    const [pattern, domain] = bestKey.split('@');
    return {
      pattern,
      domain,
      confidence: bestCount / detected.length,
      sampleCount: detected.length,
    };
  }

  // Standard detection failed. Try heuristic: pick the first example whose
  // local part starts with the first-initial AND contains the last name.
  // This catches patterns like "beryden" (Brad Ryden) where there's an
  // unknown char between f-initial and last name — we can't replicate the
  // exact pattern but 'flast' is the closest standard pattern.
  for (const ex of examples) {
    if (!ex?.name || !ex?.email || !ex.email.includes('@')) continue;
    const [localPart, dom] = ex.email.toLowerCase().split('@');
    const parts = ex.name.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const first = parts[0].replace(/[^a-z]/g, '');
    const last = parts[parts.length - 1].replace(/[^a-z]/g, '');
    if (!first || !last) continue;
    if (localPart.startsWith(first[0]) && localPart.includes(last)) {
      return {
        pattern: 'flast',
        domain: dom,
        confidence: 0.4,
        sampleCount: examples.length,
        fallback: true,
        note: `Non-standard pattern detected at this org (e.g. "${ex.email}" for ${ex.name}). Best guess uses firstinitial+lastname — verify before sending.`,
      };
    }
  }

  // Pure fallback: just grab the domain from any example and use 'flast'
  for (const ex of examples) {
    if (ex?.email && ex.email.includes('@')) {
      const dom = ex.email.toLowerCase().split('@')[1];
      if (dom) {
        return {
          pattern: 'flast',
          domain: dom,
          confidence: 0.3,
          sampleCount: examples.length,
          fallback: true,
          note: 'Pattern could not be detected. Best guess uses firstinitial+lastname (most common at K-12/Higher Ed orgs) — verify before sending.',
        };
      }
    }
  }

  return null;
}

// High-level helper: given a target name + known emails at the same org,
// return a guessed email (or null if the org's pattern can't be inferred).
// The returned object includes provenance so the UI can show confidence.
export function guessEmailForName(targetName, knownEmailsAtOrg) {
  const pattern = inferEmailPatternFromExamples(knownEmailsAtOrg);
  if (!pattern) return null;
  const email = applyEmailPattern(targetName, pattern);
  if (!email) return null;
  return {
    email,
    emailStatus: 'guessed',
    emailSource: 'pattern',
    confidence: pattern.confidence,
    patternUsed: pattern.pattern,
    basedOnSampleCount: pattern.sampleCount,
  };
}

// Classify a title into a tier (1-4). Returns 0 for unknown / non-facilities.
export function classifyTier(title) {
  if (!title) return 0;
  const t = title.toLowerCase();
  // Strategic markers (tier 4)
  if (/\b(director|vp|vice president|chief|superintendent|president|ceo|coo|cfo|executive director)\b/.test(t)) return 4;
  // Management markers (tier 3)
  if (/\b(manager|asst director|assistant director|head of)\b/.test(t)) return 3;
  // Tactical markers (tier 2)
  if (/\b(coordinator|supervisor|lead|specialist|foreman)\b/.test(t)) return 2;
  // Frontline markers (tier 1)
  if (/\b(technician|tech|worker|tradesperson|locksmith|maintenance|janitor|custodian)\b/.test(t)) return 1;
  return 0;
}

// Given a prospect's current title + segment, return the titles to search for at
// the same org. Implements the "vice versa" rule: going up AND down the ladder
// to maximize multi-threading coverage.
//
// Strategy:
//   - If current is tier 1-2 (frontline/tactical) → search tier 3-4 (where the buying happens)
//   - If current is tier 3 (management) → search tier 2 + tier 4 (peers + boss)
//   - If current is tier 4 (strategic) → search tier 2-3 (the people who actually field calls) + adjacent functions
//   - If current is unknown / non-facilities → search the full facilities ladder (start from scratch)
export function getMultiThreadTitles(currentTitle, segment) {
  const tier = classifyTier(currentTitle);
  const result = new Set();

  if (tier === 1 || tier === 2) {
    TITLE_LADDER[3].titles.forEach(t => result.add(t));
    TITLE_LADDER[4].titles.forEach(t => result.add(t));
  } else if (tier === 3) {
    TITLE_LADDER[2].titles.forEach(t => result.add(t));
    TITLE_LADDER[4].titles.forEach(t => result.add(t));
  } else if (tier === 4) {
    TITLE_LADDER[2].titles.forEach(t => result.add(t));
    TITLE_LADDER[3].titles.forEach(t => result.add(t));
    ADJACENT_FUNCTIONS.forEach(t => result.add(t));
  } else {
    // Unknown / non-facilities — pull the full middle of the ladder
    TITLE_LADDER[2].titles.forEach(t => result.add(t));
    TITLE_LADDER[3].titles.forEach(t => result.add(t));
    TITLE_LADDER[4].titles.forEach(t => result.add(t));
  }

  // Segment-specific tweaks: K-12 has Superintendent at the top regardless
  if (segment === 'K-12 Education' && tier !== 4) {
    result.add('Superintendent');
    result.add('Assistant Superintendent');
  }

  return Array.from(result);
}

// Score an unenriched candidate for the "spend remaining credits" wizard.
// Higher score = higher priority for end-of-month batch enrichment.
//   +10 — org has 0 enriched contacts (new account → highest leverage)
//   +5  — org has 1 enriched contact (multi-thread completion)
//   +3  — county is in a high-trip-score cluster
//   +2  — title is tier 3-4 (decision-maker)
//   +1  — peer of a prospect already pushed to Pipedrive (active deal)
export function scoreUnenrichedCandidate(candidate, context) {
  const { allProspects = [], pdRecords = {}, highTripCounties = new Set() } = context;
  let score = 0;

  const sameOrg = allProspects.filter(p => normalizeOrg(p.company) === normalizeOrg(candidate.company));
  const enrichedAtOrg = sameOrg.filter(p => p.email && !/(gmail|yahoo|hotmail|aol|comcast)/i.test(p.email));
  if (enrichedAtOrg.length === 0) score += 10;
  else if (enrichedAtOrg.length === 1) score += 5;

  if (candidate.county && highTripCounties.has(candidate.county)) score += 3;

  const tier = classifyTier(candidate.title);
  if (tier >= 3) score += 2;

  const parentId = candidate.parentProspectId;
  if (parentId && pdRecords[parentId] && (pdRecords[parentId].leadId || pdRecords[parentId].dealId)) {
    score += 1;
  }

  return score;
}

// Normalize an org name for fuzzy matching (strip whitespace, punctuation, common suffixes)
function normalizeOrg(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(inc|llc|corp|corporation|company|co|ltd|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// === PAIN LIBRARIES — From Anthony's three ICP infographics ===
export const PAIN_LIBRARY = profile.painLibrary;

// === SEGMENT-SPECIFIC CTAs (resource-framed, not meeting-asking) ===
// Note: avoid "a name to know" / "name you recognize" phrasing — both
// trigger Barracuda + similar enterprise spam filters (City of NSB
// rejected a send for exactly this in the subject line). Use neutral
// "put SHP on your radar" framing instead.
export const RESOURCE_CTAS = profile.resourceCtas;

// === SANDLER COACH CONTENT ===
export const PAIN_FUNNEL_TEMPLATES = profile.sandler.painFunnel;

export const UFC_TEMPLATES = profile.sandler.ufc;

export const REVERSING_RESPONSES = profile.sandler.reversing;

// === COLD EMAIL TEMPLATE (Anthony's voice + proof points + resource framing) ===
// This is the prompt the agent uses to draft cold emails.
// `softOptOut` defaults to DEFAULT_SOFT_OPT_OUT but accepts a user-override
// via Settings — kept as a parameter so it stays cleanly testable.
export function buildColdEmailPrompt(prospect, research, segment, signature, softOptOut = DEFAULT_SOFT_OPT_OUT) {
  const seg = segment || 'default';
  const cta = RESOURCE_CTAS[
    seg === 'K-12 Education' ? 'K12' :
    seg === 'Higher Education' ? 'HigherEd' :
    seg === 'Local Government' ? 'LocalGov' : 'default'
  ];

  // Pick top 2-3 contextually-relevant proof points
  const proofs = pickProofPoints(prospect, 3);
  const proofText = proofs.length > 0
    ? proofs.map(p => `- ${p.name} (${p.segment}, ${p.county} County)`).join('\n')
    : 'No specific proof points — use generic framing only';

  // Voice examples block
  const voiceExamples = VOICE_EXAMPLES.map((e, i) => `EXAMPLE ${i + 1} — ${e.context}:\n${e.body}`).join('\n\n---\n\n');

  // Research is BACKGROUND ONLY — never quoted in the email body. The
  // hasRealHook branch and the openingHook-as-opener strategy have been
  // scrapped per user direction: don't open with questions, don't disclose
  // research, use a short direct intro instead.

  return `You are drafting a cold email FROM ${SHP_IDENTITY.rep} (${SHP_IDENTITY.title} at ${SHP_IDENTITY.company}, ${SHP_IDENTITY.hq}, est. ${SHP_IDENTITY.founded}) TO ${prospect.name}, ${prospect.title} at ${prospect.company}.

═════ PROSPECT CONTEXT ═════
Name: ${prospect.name}
Title: ${prospect.title}
Company: ${prospect.company}
Segment: ${segment}
Location: ${prospect.city}, ${prospect.county || ''} County

═════ RESEARCH (BACKGROUND CONTEXT — DO NOT QUOTE OR REFERENCE IN THE EMAIL) ═════
The research below is for YOU to internalize so you can pick the right
capabilities to emphasize and the right proof points to surface. The
prospect should NEVER hear research disclosed back at them — that breaks
trust on the first read. Treat this as your private briefing, not content.

Pain signals (informs which capabilities to emphasize): ${research?.painSignals?.join('; ') || 'general facilities pain'}
Company snapshot (informs proof-point selection): ${research?.companySnapshot || ''}
Specificity: ${research?.specificityRating || 'unknown'}${research?.specificityNote ? ` — ${research.specificityNote}` : ''}

FORBIDDEN PHRASES in the body (these are the stalker tells):
  - "I noticed...", "I saw...", "I read that...", "Your recent..."
  - "How are you currently..." or any leading question as the opener
  - Specific numbers (building counts, square footage, employee counts)
  - Project names, fiscal years, dates, news items
  - Category-level disclosures: "donor-driven", "tax-funded",
    "union-staffed", "5-year CIP", "extended care hours"
  - Any question that reveals you researched them

═════ AVAILABLE PROOF POINTS (real SHP customers, ranked by relevance to this prospect) ═════
${proofText}

USE 1-2 OF THE ABOVE if (and only if) it fits naturally. Don't force a name drop. Never list more than 2. Never use names that aren't on the above list. If none fit naturally, use generic framing like "we work with multiple ${segment.toLowerCase()} partners across Central Florida."

═════ VOICE GUIDE — FOLLOW THIS EXACTLY ═════
${VOICE_GUIDE}

═════ ANTHONY'S REAL EMAIL EXAMPLES — match this voice ═════
${voiceExamples}

═════ STRUCTURE ═════
Greeting: "Hi {firstName}," — first name only, never Ms./Mr./Dr.

The email must include these four things — but NOT in a fixed order.
Vary the structure so no two drafts feel like the same template:

  WHO    — who Anthony is, that this is SHP, Longwood-based
  WHAT   — what SHP does, weighted toward this prospect's segment needs
  HUMBLE — acknowledge they likely have a vendor; position SHP as a resource
  CLOSE  — low-pressure invitation; no demands, no timelines

Mix the order. Sometimes proof anchors the opening. Sometimes the humble
frame leads. Sometimes WHO and WHAT collapse into one sentence. Sometimes
you skip the in-person offer entirely. Vary paragraph count (2–4).
Look at all six voice examples above — they use different structures.
Do not default to the same one every time.

Forbidden opener moves (no exceptions):
  × Opening with a question
  × "I hope email is OK" / preamble apologies
  × Disclosing research ("I noticed...", "I saw that...", "Your recent...")

REQUIRED — always include regardless of structure:
  • Soft opt-out on its own paragraph BEFORE sign-off. Use this line VERBATIM,
    word-for-word, do not paraphrase, do not change "doors" to "door", do not
    change "aren't" to "isn't":
    "${softOptOut}"
  • Signature block verbatim (CAN-SPAM — physical address required)

Optional — include only when contextually natural:
  • In-person offer: "I'm often in the area with a few customers, so I can
    stop by for an in-person intro if you'd prefer."
  • Proof drop: 1–2 customers from the list above, only if they fit

Soft CTA reference: ${cta}

═════ HARD RULES ═════
- 80-180 words in the body. Tight 2-paragraph emails are fine. So are fuller 4-paragraph ones. Match length to how much there is to say.
- NO exclamation points
- NO corporate filler ("hope this finds you well", "wanted to reach out", "circle back", "leverage", "synergy")
- Use SENTENCE CASE in subject line (first word capitalized; not all-lowercase). All-lowercase subjects trigger enterprise spam filters like Barracuda.
- Subject line should sound human, not marketing-y. Examples that work: "Quick intro from SHP", "Hardware partner for [their company]", "Door & hardware support for [their company]"
- AVOID in the subject: "name to know", "name you recognize", question marks, exclamation points, ALL CAPS. These are cold-email-cliché patterns that enterprise filters score against.
- The signature MUST appear verbatim with the physical postal address — required by US CAN-SPAM Act.

═════ SIGNATURE ═════
End the body with this exact signature block:

${signature || DEFAULT_SIGNATURE}

═════ OUTPUT ═════
Return ONLY this JSON object, no preamble, no markdown fences:
{
  "subject": "primary subject line",
  "body": "full body with \\n line breaks, including the signature",
  "subjectAlts": [
    "alternative subject line 2",
    "alternative subject line 3"
  ],
  "linkedinMsg": "LinkedIn connection request under 200 chars — no pitch, just introduce yourself as a local hardware resource worth knowing. Plain text, conversational.",
  "followUps": {
    "day3": {
      "subject": "...",
      "body": "Short plain-text follow-up. Different angle from the cold email. No signature needed — keep it under 60 words."
    },
    "day7": {
      "subject": "...",
      "body": "New value prop or a different proof point. Still short. Under 60 words."
    },
    "day14": {
      "subject": "...",
      "body": "Break-up email. Acknowledge they may not need this now. Leave the door open. Under 50 words."
    }
  }
}`;
}

// === FOLLOW-UP CADENCE ===
export const FOLLOW_UP_DAYS = profile.followUpDays;

// Lead title — same format as deal so when converted in Pipedrive, the title carries forward
export function buildLeadTitle(prospect, segment) {
  return `${prospect.company} — ${segment} — Outbound Lead`;
}

// === DENSITY CLUSTERING ===
// Groups prospects by city, then merges nearby cities into clusters
// Returns array of clusters, ranked by size
export function buildClusters(prospects) {
  const byCounty = {};
  prospects.forEach(p => {
    if (!p.county || p.icpStatus === 'out') return;
    if (!byCounty[p.county]) byCounty[p.county] = [];
    byCounty[p.county].push(p);
  });

  return Object.entries(byCounty)
    .map(([county, list]) => ({
      county,
      size: list.length,
      bySegment: list.reduce((acc, p) => {
        acc[p.segment] = (acc[p.segment] || 0) + 1;
        return acc;
      }, {}),
      withEmail: list.filter(p => p.email).length,
      tripScore: list.length + list.filter(p => p.email).length, // simple weighting
      prospects: list,
    }))
    .filter(c => c.size >= 2) // user threshold: 2+
    .sort((a, b) => b.tripScore - a.tripScore);
}
