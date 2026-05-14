// SHP Outbound Agent — Strategy Module v3
// All ICP, pain, and Sandler content lives here so it can be updated without touching UI

export const SHP_IDENTITY = {
  rep: 'Anthony Koscielecki',
  title: 'Regional Sales Consultant',
  company: 'Superior Hardware Products',
  directPhone: '407-725-8744',
  officePhone: '407-339-6800',
  email: 'anthony@superiorhardwareproducts.com',
  contactCardUrl: 'https://dot.cards/anthonyshp',
  founded: 1986,
  hq: 'Longwood, FL',
  // Default physical address used in CAN-SPAM-compliant signatures.
  // User can override via Settings → companyAddress.
  // CAN-SPAM (15 U.S.C. 7704) requires a valid physical postal address
  // in every commercial email. Update this to the actual SHP street address.
  companyAddress: 'Superior Hardware Products · Longwood, FL',
  pillars: [
    'One Source for Door Openings',
    'Built for High-Traffic Environments',
    'A Partner for Facilities Teams',
  ],
  capabilities: [
    'Access Control Compatible Hardware',
    'Keying & Master Key Systems',
    'Wood & Hollow Metal Doors',
    'Automatic Openers & Sliders',
    'Fire Door Inspections',
    'Code & Compliance Support',
  ],
};

// Default email signature — multi-line, used in every cold email.
// Includes the physical address per CAN-SPAM Act (US 15 USC §7704). Anyone
// editing this MUST keep a physical postal address in the signature.
export const DEFAULT_SIGNATURE = `Anthony Koscielecki
Regional Sales Consultant

Direct: 407-725-8744
Office: 407-339-6800
Email: anthony@superiorhardwareproducts.com

Save my contact card: https://dot.cards/anthonyshp

Superior Hardware Products · Longwood, FL`;

// Default soft opt-out line — Anthony's voice, not corporate-CYA. Always
// included in cold emails so recipients have a frictionless way to say "no thanks"
// instead of marking the email as spam (which damages domain reputation).
export const DEFAULT_SOFT_OPT_OUT =
  `If door & hardware isn't on your radar, just let me know and I'll close the loop on my end.`;

// Touch-cap defaults — guards against "harassment" complaints from
// over-emailing the same prospect. After this many sends with no reply,
// the agent surfaces a warning and asks the user to pause.
export const DEFAULT_MAX_TOUCHES = 3;

// === CUSTOMER PROOF POINTS ===
// Curated from 2025 invoice data. named=true means OK to drop the name in cold email body.
// named=false means count toward generic framing only (e.g., "we work with major contractors").
// Cross-segment dropping is allowed — proximity (county) matters more than exact-segment match.
export const CUSTOMERS = [
  // Healthcare — Anthony confirmed OK to name
  { name: 'AdventHealth Fish Memorial Hospital', segment: 'Healthcare', county: 'Volusia', revenue: 359922, named: true },
  { name: 'AdventHealth Deland', segment: 'Healthcare', county: 'Volusia', revenue: 56880, named: true },
  { name: 'AdventHealth', segment: 'Healthcare', county: 'Multi', revenue: 14294, named: true },
  { name: 'Davita Lab', segment: 'Healthcare', county: 'Volusia', revenue: 16645, named: true },
  { name: 'Orlando Health - Health Central', segment: 'Healthcare', county: 'Orange', revenue: 9767, named: true },
  { name: 'Hospice of Marion County', segment: 'Healthcare', county: 'Marion', revenue: 9332, named: true },
  { name: "Nemours Children's Health", segment: 'Healthcare', county: 'Orange', revenue: 3938, named: true },
  // Local Government — strong pillar
  { name: 'City of Deland', segment: 'Local Government', county: 'Volusia', revenue: 43350, named: true },
  { name: 'Sanford Airport Authority', segment: 'Local Government', county: 'Seminole', revenue: 39101, named: true },
  { name: 'Seminole County', segment: 'Local Government', county: 'Seminole', revenue: 34341, named: true },
  { name: 'City of Altamonte Springs', segment: 'Local Government', county: 'Seminole', revenue: 22746, named: true },
  { name: 'City of Oviedo', segment: 'Local Government', county: 'Seminole', revenue: 13720, named: true },
  { name: 'City of Tavares', segment: 'Local Government', county: 'Lake', revenue: 9834, named: true },
  { name: 'FAA Daytona / Sanford', segment: 'Local Government', county: 'Volusia', revenue: 7736, named: true },
  { name: 'City of South Daytona', segment: 'Local Government', county: 'Volusia', revenue: 5826, named: true },
  { name: 'City of Deltona', segment: 'Local Government', county: 'Volusia', revenue: 4612, named: true },
  { name: 'Jacksonville Job Corps', segment: 'Local Government', county: 'Duval', revenue: 3130, named: true },
  { name: 'Seminole Electric Cooperative', segment: 'Local Government', county: 'Multi', revenue: 2612, named: true },
  { name: 'City of DeBary Public Works', segment: 'Local Government', county: 'Volusia', revenue: 362, named: true },
  // Higher Education — small pillar but recognizable names
  { name: 'Stetson University', segment: 'Higher Education', county: 'Volusia', revenue: 65865, named: true },
  { name: 'Lake-Sumter State College', segment: 'Higher Education', county: 'Sumter', revenue: 19123, named: true },
  { name: 'Florida State College Jacksonville-South', segment: 'Higher Education', county: 'Duval', revenue: 5154, named: true },
  { name: 'Seminole State College', segment: 'Higher Education', county: 'Seminole', revenue: 4399, named: true },
  { name: 'University of Florida', segment: 'Higher Education', county: 'Alachua', revenue: 3817, named: true },
  // K-12 Education — thin pillar but two great names
  { name: "The Master's Academy", segment: 'K-12 Education', county: 'Seminole', revenue: 34747, named: true },
  { name: 'Volusia County School Board', segment: 'K-12 Education', county: 'Volusia', revenue: 21809, named: true },
];

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

// === VOICE EXAMPLES ===
// Anthony's actual cold email templates. Used as few-shot examples in the prompt
// so AI drafts match his real voice (humble + "arrow in quiver" + peer tone).
export const VOICE_EXAMPLES = [
  {
    context: 'Cold-cold, no research hook, "found you on website" framing',
    body: `I got your name while wandering the [their website], hoping to get the right person some information about Superior Hardware Products.

Because I know how important doors are, I know you likely have someone for what we do, but I wanted to get you some information in case you need another arrow in your quiver.

In short, we can handle everything related to your door openings — from mechanical to electrified to automatics. SHP can provide, service, and install anything related to doors or hardware. I included our one-pager for easy reference.

Let me know if the timing is right for a conversation, or if there's another person I should reach out to.

I'm often in the area with a few customers, so I can stop by for an in-person intro if you'd prefer.`,
  },
  {
    context: 'New-rep introduction to existing customer (warm-ish, but useful pattern)',
    body: `I am new to the SHP team and wanted to reach out for a quick introduction.

I am now responsible for what we call N. Central Florida, which you are a part of.

My list shows you as an active customer, so I want to ensure I have a good understanding of your needs so that I can best support your team/facility(s).

Ideally, we would find some time to meet in person, but we can set up a call or video meeting if you would prefer.

If you need to become more familiar with SHP, I have attached a snapshot of our capabilities.`,
  },
  {
    context: 'Email-OK soft opener with peer credibility',
    body: `I hope email is OK. I did not want to interrupt your day with a phone call, so I wanted to send a quick note introducing Superior Hardware Products.

Our team provides service and installation for everything in your doorways across your facilities.

We are proud to work with multiple [match-segment-or-region peers] across Central Florida, bridging the gap between their access control provider and locksmith. Our successful partnerships speak to our capabilities, and we can bring your team the same level of service.

If you think there is an opportunity to support your team, I would appreciate the chance to discuss our capabilities.`,
  },
];

// === VOICE GUIDE — what makes Anthony's voice his ===
export const VOICE_GUIDE = `
ANTHONY'S VOICE — characteristics the draft must hit:

1. HUMBLE-CONFIDENT FRAMING. Acknowledge they probably have a vendor before pitching. Phrases like:
   - "I know you likely have someone for what we do, but..."
   - "I am sure you already have a resource, but..."
   - "Wanted to ask if it was worth the time for an intro to have another arrow in the quiver"

2. RESOURCE-FRAMED, NOT MEETING-DEMANDING. Don't ask for a meeting outright. Position SHP as a resource they can lean on:
   - "Wanted to be a name you recognize when something comes up"
   - "If anything's active, happy to walk it with you"
   - "Let me know if the timing is right for a conversation"

3. PEER TONE. Conversational, not corporate. Allowed:
   - "I hope email is OK"
   - "I did not want to interrupt your day with a phone call"
   - "I'm often in the area with a few customers, so I can stop by for an in-person intro if you'd prefer"
   - "another arrow in your quiver" / "another quiver in your arsenal"

4. PROOF DROPS, WHEN APPROPRIATE. When naming customers, keep it natural:
   - "We're proud to work with multiple [public sector / educational] partners across Central Florida, including [Customer A] and [Customer B]"
   - "Our team supports [Customer C] in [their county] and operates throughout the area"
   NEVER: "We are pleased to announce our work with..." (corporate-sounding)
   NEVER: list 5+ customers in a row (overkill)

5. NO. EXCLAMATION. POINTS. Anthony's templates don't use them. Period.

6. NO CORPORATE FILLER. Forbidden:
   - "I hope this finds you well"
   - "I wanted to reach out"
   - "circle back" / "leverage" / "synergy" / "value-add"
   - "best-in-class" / "industry-leading"

7. SIGN OFF SIMPLE. Just a polite close, then signature. No "warm regards" or "sincerely yours."
   - "Best Regards"
   - "Look forward to connecting"
   - "Have a great week"
`;


// =====================================================================
// === EMAIL LIBRARY ===================================================
// =====================================================================
// Deterministic email composition. Builds emails from structured pieces
// rather than calling AI for every draft. Each piece is in Anthony's voice,
// drawn from his real templates. Composer logic picks pieces based on
// prospect context (segment, county, title altitude, proof points available).
//
// Three categories: opener / body / cta
// Each variant has metadata (`when`) describing when the composer should pick it.
// Variants use {placeholders} that the composer fills at runtime.
//
// To edit: add/remove/modify variants in any bank. The composer reads the
// banks at runtime — no UI changes needed.

// === OPENER BANK ===
// Picks one based on context (geography match, title altitude, etc.)
export const OPENER_BANK = [
  {
    id: 'A_workhorse',
    when: 'default — works for any cold outreach',
    text: `I got your name while looking around for the right person at {company} to share some information with about Superior Hardware Products.`,
  },
  {
    id: 'C_geography',
    when: 'fires when there\'s a same-county customer to anchor on',
    text: `I came across {company} while working with a few customers in {county} County and wanted to make sure you knew about Superior Hardware Products.`,
    requires: ['sameCountyCustomer'],
  },
  {
    id: 'F_higher_altitude',
    when: 'fires for Director / VP / Superintendent / decision-maker titles',
    text: `I was looking for the right facilities contact at {company} and your name came up. Wanted to introduce SHP briefly.`,
    requires: ['strategicTitle'],
  },
];

// === BODY BANK ===
// Each body has the humble-confident framing + capability + (optional) proof drop.
// Composer picks based on segment, prospect type, and whether proof points are present.
// {proof} placeholder gets replaced with a contextual customer reference, or removed cleanly.
// `avoidWhen` flags let the composer skip variants in inappropriate contexts.
export const BODY_BANK = [
  {
    id: 'B1_arrow_in_quiver_default',
    when: 'default — humble framing + capability summary, with optional proof drop',
    text: `I know you likely have someone for what we do, but I wanted to get you some information in case you need another arrow in your quiver.

In short, we can handle everything related to your door openings — from mechanical to electrified to automatics. SHP can provide, service, and install anything related to doors or hardware.{proof}`,
  },
  {
    id: 'B2_proud_to_support_partners',
    when: 'fires when proof points exist for this prospect',
    text: `Our team provides service and installation for everything in your doorways across your facilities.

We're proud to work with {proofList} across Central Florida, bridging the gap between access control providers and locksmiths. Our successful partnerships speak to our capabilities, and we'd like the chance to bring your team the same level of service.`,
    requires: ['hasProofPoints'],
  },
  {
    id: 'B3_capability_focused',
    when: 'fires when proof points are weak or absent — leads with capability',
    text: `In short, we specialize in the supply and installation of commercial doors, frames, hardware, and access control packages.

We cover all of Central Florida, working primarily with public school systems, county and city governments, hospitals, and colleges. Our facility is in Longwood, just outside of Orlando.{proof}`,
  },
  {
    id: 'B4_full_capability_list',
    when: 'fires when prospect appears to need broad capability awareness (multi-segment or unclear)',
    text: `I wanted to take a moment to introduce myself and see how I might assist with your door or hardware needs.

We specialize in a wide range of services including hollow metal and wood doors, automatics, access control, rekeying, and more. Best of all, we provide both installation and service for everything we offer.{proof}`,
  },
  {
    id: 'B5_humble_resource',
    when: 'soft-touch variant — leans heavily into resource framing, lighter capability',
    text: `I know you may already have a vendor for door and hardware work, but wanted to put SHP on your radar in case anything's not getting the attention it deserves — or if you're just looking for a second option for next time.

We're a 40-year family shop in Longwood that handles everything from a single broken closer to full master key system rebuilds across multi-building portfolios.{proof}`,
  },
  {
    id: 'B6_existing_relationship',
    when: 'fires when SHP already has a customer relationship with this organization (different contact)',
    text: `We already work with your team on the door and hardware side, but I wanted to make sure I was connected with the right person on facilities decisions going forward.

Happy to share what we currently support and where we might be able to help further.`,
    requires: ['hasExistingRelationship'],
  },
  {
    id: 'B7_short_intro',
    when: 'shortest variant — when you want minimal email volume. Avoid for high-altitude titles.',
    text: `Wanted to introduce Superior Hardware Products. We handle commercial doors, frames, hardware, automatics, and access control across Central Florida.{proof}`,
    avoidWhen: ['strategicTitle'], // too thin for Directors/VPs
  },
];

// === CTA BANK ===
// Soft CTAs in Anthony's voice. Composer rotates based on context.
export const CTA_BANK = [
  {
    id: 'CTA1_timing',
    when: 'default — neutral, no pressure',
    text: `Let me know if the timing is right for a conversation, or if there's another person I should reach out to.`,
  },
  {
    id: 'CTA2_in_person',
    when: 'fires when prospect is in CFL North (geographically reachable)',
    text: `I'm often in the area with a few customers, so I can stop by for an in-person intro if you'd prefer.`,
    requires: ['inProximity'],
  },
  {
    id: 'CTA3_resource_framing',
    when: 'fires when prospect is unlikely to have an immediate need',
    text: `Just wanted to be a name you recognize when something comes up — propped door, broken closer, mid-year hardware failure. If anything's already on your radar, happy to walk it with you.`,
  },
  {
    id: 'CTA4_low_pressure',
    when: 'softest CTA — pure no-pressure',
    text: `No need to act on anything today. Happy to chat or just be a name to keep in mind for when something comes up.`,
  },
  {
    id: 'CTA5_direct_offer',
    when: 'fires for higher-altitude titles where directness reads as respect',
    text: `If you need a reliable door and hardware partner, I'd appreciate the chance to connect briefly to discuss our capabilities.`,
    requires: ['strategicTitle'],
  },
];

// === SUBJECT LINE BANK ===
// 8-10 variants. Composer picks one. All sentence-case, no clickbait.
export const SUBJECT_BANK = [
  'quick intro from SHP — {company}',
  'a name to know for door work — {company}',
  'hardware partner for {company}',
  'door + hardware support for {company}',
  'another resource for {company}\'s facility team',
  'wanted to introduce SHP to {company}',
  'door & hardware coverage for {company}',
  'introducing Superior Hardware Products',
  '{firstName} — quick intro from SHP',
  'SHP — door and hardware support in {county}',
];

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

  // === PICK OPENER ===
  const opener = pickVariant(OPENER_BANK, ctx, avoid) || OPENER_BANK[0];

  // === PICK BODY ===
  const body = pickVariant(BODY_BANK, ctx, avoid) || BODY_BANK[0];

  // === PICK CTA ===
  const cta = pickVariant(CTA_BANK, ctx, avoid) || CTA_BANK[0];

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
  const openerText = fillTemplate(opener.text, fillVars);
  const bodyText = fillTemplate(body.text, fillVars);
  const ctaText = fillTemplate(cta.text, fillVars);

  // === ASSEMBLE ===
  // Soft opt-out always appears as its own paragraph between the CTA and the
  // sign-off so recipients can decline without filing a spam complaint.
  const optOutLine = softOptOut ? `\n\n${softOptOut}` : '';
  const fullBody = `Hi ${greetingName},

${openerText}

${bodyText}

${ctaText}${optOutLine}

Best Regards,

${signature || DEFAULT_SIGNATURE}`;

  return {
    subject,
    body: fullBody,
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


export const TERRITORY = {
  name: 'CFL North End User',
  counties: [
    'Duval', 'St. Johns', 'Clay', 'Nassau', 'Alachua',
    'Marion', 'Volusia', 'Seminole', 'Flagler', 'Lake', 'Sumter',
    'Putnam', 'Hernando', 'Citrus', 'Orange',
  ],
};

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
export const ZIP_TO_COUNTY = {
  // Duval — Jacksonville and beach communities
  '32099': 'Duval', '32202': 'Duval', '32203': 'Duval', '32204': 'Duval', '32205': 'Duval',
  '32206': 'Duval', '32207': 'Duval', '32208': 'Duval', '32209': 'Duval', '32210': 'Duval',
  '32211': 'Duval', '32212': 'Duval', '32214': 'Duval', '32216': 'Duval', '32217': 'Duval',
  '32218': 'Duval', '32219': 'Duval', '32220': 'Duval', '32221': 'Duval', '32222': 'Duval',
  '32223': 'Duval', '32224': 'Duval', '32225': 'Duval', '32226': 'Duval', '32227': 'Duval',
  '32228': 'Duval', '32233': 'Duval', '32234': 'Duval', '32244': 'Duval', '32246': 'Duval',
  '32250': 'Duval', '32254': 'Duval', '32256': 'Duval', '32257': 'Duval', '32258': 'Duval',
  '32266': 'Duval', '32277': 'Duval',

  // St. Johns — St. Augustine, Ponte Vedra
  '32080': 'St. Johns', '32081': 'St. Johns', '32082': 'St. Johns', '32084': 'St. Johns',
  '32085': 'St. Johns', '32086': 'St. Johns', '32092': 'St. Johns', '32095': 'St. Johns',
  '32145': 'St. Johns',
  // Elkton, Hastings, St. Augustine area
  '32033': 'St. Johns', '32145B': 'St. Johns',

  // Clay — Orange Park, Green Cove Springs, Middleburg, Keystone Heights
  '32003': 'Clay', '32043': 'Clay', '32050': 'Clay', '32063': 'Clay', '32065': 'Clay',
  '32067': 'Clay', '32068': 'Clay', '32073': 'Clay', '32079': 'Clay', '32656': 'Clay',

  // Nassau — Fernandina Beach, Yulee, Callahan, Hilliard
  '32009': 'Nassau', '32011': 'Nassau', '32034': 'Nassau', '32035': 'Nassau', '32041': 'Nassau',
  '32046': 'Nassau', '32097': 'Nassau',

  // Alachua — Gainesville, Newberry, Alachua, High Springs
  '32601': 'Alachua', '32603': 'Alachua', '32605': 'Alachua', '32606': 'Alachua', '32607': 'Alachua',
  '32608': 'Alachua', '32609': 'Alachua', '32612': 'Alachua', '32615': 'Alachua', '32618': 'Alachua',
  '32641': 'Alachua', '32643': 'Alachua', '32653': 'Alachua', '32667': 'Alachua', '32669': 'Alachua',

  // Marion — Ocala, Belleview, Dunnellon, Silver Springs
  '34470': 'Marion', '34471': 'Marion', '34472': 'Marion', '34473': 'Marion', '34474': 'Marion',
  '34475': 'Marion', '34476': 'Marion', '34479': 'Marion', '34480': 'Marion', '34481': 'Marion',
  '34482': 'Marion', '34488': 'Marion', '34491': 'Marion',
  '32113': 'Marion', '32179': 'Marion', '32195': 'Marion',
  '34420': 'Marion', '34431': 'Marion', '34432': 'Marion', '34433': 'Marion',

  // Volusia — Daytona Beach, DeLand, Deltona, New Smyrna Beach, Edgewater, Port Orange
  '32114': 'Volusia', '32117': 'Volusia', '32118': 'Volusia', '32119': 'Volusia', '32124': 'Volusia',
  '32127': 'Volusia', '32128': 'Volusia', '32129': 'Volusia', '32130': 'Volusia', '32132': 'Volusia',
  '32141': 'Volusia', '32168': 'Volusia', '32169': 'Volusia', '32170': 'Volusia', '32174': 'Volusia',
  '32175': 'Volusia', '32180': 'Volusia', '32190': 'Volusia', '32713': 'Volusia', '32720': 'Volusia',
  '32721': 'Volusia', '32724': 'Volusia', '32725': 'Volusia', '32728': 'Volusia', '32738': 'Volusia',
  '32739': 'Volusia', '32759': 'Volusia', '32763': 'Volusia', '32764': 'Volusia',

  // Seminole — Sanford, Lake Mary, Altamonte Springs, Casselberry, Oviedo, Longwood, Winter Springs
  '32701': 'Seminole', '32707': 'Seminole', '32708': 'Seminole', '32714': 'Seminole',
  '32715': 'Seminole', '32716': 'Seminole', '32718': 'Seminole', '32719': 'Seminole',
  '32730': 'Seminole', '32732': 'Seminole', '32733': 'Seminole', '32746': 'Seminole',
  '32750': 'Seminole', '32751': 'Seminole', '32762': 'Seminole', '32765': 'Seminole',
  '32766': 'Seminole', '32771': 'Seminole', '32772': 'Seminole', '32773': 'Seminole',
  '32779': 'Seminole',

  // Flagler — Palm Coast, Bunnell, Flagler Beach
  '32110': 'Flagler', '32136': 'Flagler', '32137': 'Flagler', '32142': 'Flagler', '32164': 'Flagler',

  // Lake — Eustis, Tavares, Leesburg, Clermont, Mount Dora, Lady Lake, Groveland, Minneola
  '32102': 'Lake', '32159': 'Lake', '32702': 'Lake', '32726': 'Lake', '32727': 'Lake',
  '32735': 'Lake', '32736': 'Lake', '32756': 'Lake', '32757': 'Lake', '32767': 'Lake',
  '32776': 'Lake', '32778': 'Lake', '32784': 'Lake', '32788': 'Lake',
  '34705': 'Lake', '34711': 'Lake', '34712': 'Lake', '34714': 'Lake', '34715': 'Lake',
  '34736': 'Lake', '34737': 'Lake', '34748': 'Lake', '34749': 'Lake', '34753': 'Lake',
  '34755': 'Lake', '34756': 'Lake', '34762': 'Lake',

  // Sumter — Bushnell, Wildwood, Coleman, Webster, The Villages (south portion in Sumter)
  '33513': 'Sumter', '33514': 'Sumter', '33538': 'Sumter', '33585': 'Sumter', '33597': 'Sumter',
  '34484': 'Sumter', '34785': 'Sumter', '34788': 'Sumter',
  '32162': 'Sumter', '32163': 'Sumter',

  // Putnam — Palatka, Interlachen, Crescent City, Welaka
  '32112': 'Putnam', '32131': 'Putnam', '32140': 'Putnam', '32147': 'Putnam', '32148': 'Putnam',
  '32157': 'Putnam', '32177': 'Putnam', '32181': 'Putnam', '32185': 'Putnam', '32187': 'Putnam',
  '32189': 'Putnam',

  // Hernando — Brooksville, Spring Hill, Weeki Wachee, Ridge Manor
  '34601': 'Hernando', '34602': 'Hernando', '34604': 'Hernando', '34606': 'Hernando',
  '34607': 'Hernando', '34608': 'Hernando', '34609': 'Hernando', '34610': 'Hernando',
  '34611': 'Hernando', '34613': 'Hernando', '34614': 'Hernando', '34636': 'Hernando',
  '34669': 'Hernando',

  // Citrus — Inverness, Crystal River, Homosassa, Lecanto, Beverly Hills, Hernando (city)
  '34423': 'Citrus', '34428': 'Citrus', '34429': 'Citrus', '34433': 'Citrus', '34436': 'Citrus',
  '34442': 'Citrus', '34445': 'Citrus', '34446': 'Citrus', '34448': 'Citrus', '34449': 'Citrus',
  '34450': 'Citrus', '34452': 'Citrus', '34453': 'Citrus', '34461': 'Citrus', '34465': 'Citrus',
  '34487': 'Citrus', '34498': 'Citrus',

  // Orange — Orlando, Winter Park, Apopka, Ocoee, Winter Garden, Maitland, Pine Hills, Belle Isle
  '32703': 'Orange', '32709': 'Orange', '32712': 'Orange', '32789': 'Orange', '32792': 'Orange',
  '32793': 'Orange',
  '32801': 'Orange', '32803': 'Orange', '32804': 'Orange', '32805': 'Orange', '32806': 'Orange',
  '32807': 'Orange', '32808': 'Orange', '32809': 'Orange', '32810': 'Orange', '32811': 'Orange',
  '32812': 'Orange', '32814': 'Orange', '32817': 'Orange', '32818': 'Orange', '32819': 'Orange',
  '32820': 'Orange', '32821': 'Orange', '32822': 'Orange', '32824': 'Orange', '32825': 'Orange',
  '32826': 'Orange', '32827': 'Orange', '32828': 'Orange', '32829': 'Orange', '32831': 'Orange',
  '32832': 'Orange', '32833': 'Orange', '32834': 'Orange', '32835': 'Orange', '32836': 'Orange',
  '32837': 'Orange', '32839': 'Orange',
  '34734': 'Orange', '34760': 'Orange', '34761': 'Orange', '34786': 'Orange', '34787': 'Orange',
};

// City → County map for territory classification
export const CITY_TO_COUNTY = {
  // Duval
  'jacksonville': 'Duval', 'jacksonville beach': 'Duval', 'atlantic beach': 'Duval',
  'neptune beach': 'Duval', 'baldwin': 'Duval',
  // St. Johns
  'st. augustine': 'St. Johns', 'st augustine': 'St. Johns', 'saint augustine': 'St. Johns',
  'ponte vedra': 'St. Johns', 'ponte vedra beach': 'St. Johns', 'st. johns': 'St. Johns',
  'st johns': 'St. Johns', 'world golf village': 'St. Johns', 'fruit cove': 'St. Johns',
  'hastings': 'St. Johns', 'palm valley': 'St. Johns', 'vilano beach': 'St. Johns',
  'elkton': 'St. Johns', 'st augustine beach': 'St. Johns',
  // Clay
  'orange park': 'Clay', 'fleming island': 'Clay', 'middleburg': 'Clay',
  'green cove springs': 'Clay', 'keystone heights': 'Clay', 'lakeside': 'Clay',
  'penney farms': 'Clay',
  // Nassau
  'fernandina beach': 'Nassau', 'yulee': 'Nassau', 'callahan': 'Nassau',
  'hilliard': 'Nassau', 'amelia island': 'Nassau',
  // Alachua
  'gainesville': 'Alachua', 'alachua': 'Alachua', 'newberry': 'Alachua',
  'archer': 'Alachua', 'high springs': 'Alachua', 'hawthorne': 'Alachua',
  'waldo': 'Alachua', 'la crosse': 'Alachua', 'micanopy': 'Alachua',
  // Marion
  'ocala': 'Marion', 'belleview': 'Marion', 'dunnellon': 'Marion',
  'silver springs': 'Marion', 'reddick': 'Marion', 'mcintosh': 'Marion',
  'the villages': 'Marion', 'on top of the world': 'Marion',
  'summerfield': 'Marion', 'marion oaks': 'Marion', 'fort mccoy': 'Marion',
  'anthony': 'Marion', 'citra': 'Marion', 'sparr': 'Marion',
  'weirsdale': 'Marion', 'silver springs shores': 'Marion',
  // Volusia
  'daytona beach': 'Volusia', 'deland': 'Volusia', 'de land': 'Volusia',
  'deltona': 'Volusia', 'port orange': 'Volusia', 'ormond beach': 'Volusia',
  'new smyrna beach': 'Volusia', 'edgewater': 'Volusia', 'orange city': 'Volusia',
  'debary': 'Volusia', 'de bary': 'Volusia', 'holly hill': 'Volusia',
  'lake helen': 'Volusia', 'pierson': 'Volusia', 'oak hill': 'Volusia',
  'south daytona': 'Volusia', 'daytona beach shores': 'Volusia',
  'ponce inlet': 'Volusia', 'osteen': 'Volusia', 'cassadaga': 'Volusia',
  // Seminole
  'sanford': 'Seminole', 'altamonte springs': 'Seminole', 'casselberry': 'Seminole',
  'lake mary': 'Seminole', 'longwood': 'Seminole', 'oviedo': 'Seminole',
  'winter springs': 'Seminole', 'heathrow': 'Seminole', 'wekiva springs': 'Seminole',
  'forest city': 'Seminole', 'fern park': 'Seminole', 'chuluota': 'Seminole',
  'geneva': 'Seminole', 'midway': 'Seminole',
  // Flagler
  'palm coast': 'Flagler', 'bunnell': 'Flagler', 'flagler beach': 'Flagler',
  'beverly beach': 'Flagler', 'marineland': 'Flagler',
  // Lake
  'leesburg': 'Lake', 'eustis': 'Lake', 'tavares': 'Lake', 'mount dora': 'Lake',
  'mt dora': 'Lake', 'mt. dora': 'Lake', 'clermont': 'Lake', 'minneola': 'Lake',
  'groveland': 'Lake', 'mascotte': 'Lake', 'fruitland park': 'Lake',
  'lady lake': 'Lake', 'umatilla': 'Lake', 'astatula': 'Lake',
  'howey-in-the-hills': 'Lake', 'howey in the hills': 'Lake',
  'montverde': 'Lake', 'four corners': 'Lake', 'sorrento': 'Lake',
  'paisley': 'Lake', 'altoona': 'Lake', 'okahumpka': 'Lake',
  // Sumter
  'wildwood': 'Sumter', 'bushnell': 'Sumter', 'webster': 'Sumter',
  'coleman': 'Sumter', 'center hill': 'Sumter', 'sumterville': 'Sumter',
  // Putnam
  'palatka': 'Putnam', 'east palatka': 'Putnam', 'crescent city': 'Putnam',
  'interlachen': 'Putnam', 'welaka': 'Putnam', 'pomona park': 'Putnam',
  'satsuma': 'Putnam',
  // Hernando
  'brooksville': 'Hernando', 'spring hill': 'Hernando',
  'weeki wachee': 'Hernando', 'masaryktown': 'Hernando', 'ridge manor': 'Hernando',
  // Citrus
  'crystal river': 'Citrus', 'inverness': 'Citrus', 'homosassa': 'Citrus',
  'beverly hills': 'Citrus', 'lecanto': 'Citrus', 'hernando': 'Citrus',
  'floral city': 'Citrus', 'citrus springs': 'Citrus',
  // Orange
  'orlando': 'Orange', 'winter park': 'Orange', 'ocoee': 'Orange',
  'apopka': 'Orange', 'winter garden': 'Orange', 'maitland': 'Orange',
  'belle isle': 'Orange', 'edgewood': 'Orange', 'windermere': 'Orange',
  'oakland': 'Orange', 'eatonville': 'Orange', 'taft': 'Orange',
  'pine hills': 'Orange', 'goldenrod': 'Orange', 'azalea park': 'Orange',
  'doctor phillips': 'Orange', 'lake buena vista': 'Orange',
  'meadow woods': 'Orange', 'union park': 'Orange', 'conway': 'Orange',
  'hunters creek': 'Orange', 'metrowest': 'Orange', 'lake nona': 'Orange',
  'gotha': 'Orange', 'killarney': 'Orange',
};

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
export const TITLE_LADDER = {
  1: { name: 'Frontline', titles: [
    'Maintenance Technician', 'Facilities Technician', 'Building Technician',
    'Maintenance Worker', 'Tradesperson', 'Locksmith', 'Door Technician',
  ]},
  2: { name: 'Tactical', titles: [
    'Facilities Coordinator', 'Maintenance Coordinator', 'Operations Coordinator',
    'Facilities Supervisor', 'Maintenance Supervisor', 'Facilities Lead',
    'Facilities Specialist', 'Maintenance Specialist',
  ]},
  3: { name: 'Management', titles: [
    'Facilities Manager', 'Maintenance Manager', 'Operations Manager',
    'Building Manager', 'Plant Manager', 'Senior Facilities Manager',
    'Assistant Director of Facilities', 'Assistant Director of Operations',
  ]},
  4: { name: 'Strategic', titles: [
    'Director of Facilities', 'Director of Maintenance', 'Director of Operations',
    'Director of Plant Operations', 'Director of Buildings and Grounds',
    'VP Facilities', 'VP Operations', 'Vice President of Facilities',
    'Executive Director of Facilities', 'Chief Facilities Officer',
    'Chief Operating Officer', 'Superintendent', 'Assistant Superintendent',
  ]},
};

// Adjacent functions worth multi-threading to when you have a C-suite contact —
// these touch door/hardware purchasing decisions even though they're not "facilities."
export const ADJACENT_FUNCTIONS = [
  'Director of Procurement', 'Procurement Manager', 'Purchasing Manager',
  'Director of Safety', 'Safety Manager', 'Director of Security',
  'Director of Capital Projects', 'Construction Manager', 'Project Manager Construction',
  'Director of Risk Management',
];

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
export const PAIN_LIBRARY = {
  'K-12 Education': {
    strategic: [
      'aging campus infrastructure creating compliance and life-safety exposure',
      'capital budget cycles forcing reactive emergency repairs over planned replacement',
      'campus safety mandates driving demand for access-control-compatible hardware',
      'maintenance demands outpacing in-house staff capacity',
      'multi-building vendor coordination overhead',
      'fire door inspection and ADA compliance gaps across the campus',
    ],
    tactical: [
      'high-traffic classroom doors with repeat wear and hardware failures',
      'doors propped open due to broken closers, creating safety and liability exposure',
      'master keys copied untracked across staff turnover',
      'cafeteria and gym automatic openers needing service',
      'panic hardware failures on athletic facility exit doors',
      'lost or unreturned keys forcing emergency rekeys',
    ],
  },
  'Higher Education': {
    strategic: [
      'inconsistent hardware standards across mixed-vintage buildings',
      'access-control integration with campus-wide card systems',
      'life-safety and fire-door compliance across hundreds of openings',
      'planned replacement programs aligned to capital budget cycles',
      'master key system complexity across layered hierarchies',
      'one-vendor-per-opening-type sprawl',
    ],
    tactical: [
      'residence hall lockset failures during turn season',
      'student-center automatic openers and storefront systems',
      'panic hardware on auditorium and athletic facility exits',
      'restricted-access keying for labs and IT zones',
      'frequent rekeys across dorms and offices',
      'high-traffic exterior doors showing accelerated wear',
    ],
  },
  'Local Government': {
    strategic: [
      'public-facing facilities built 1970s–2000s past service life',
      'phased capital planning around budget cycles vs. emergency reactive spend',
      'fire-door, ADA, and life-safety audit exposure in older buildings',
      'small in-house teams managing large multi-building portfolios',
      'security needs across restricted areas and after-hours access',
      'one-source coordination across hollow metal, automatics, and access control',
    ],
    tactical: [
      'high-traffic doors on courthouses and community centers',
      'public safety facility access — restricted, panic, after-hours',
      'key sprawl across departments and contractors',
      'aging hollow metal doors and frames in admin buildings',
      'parks and library facilities needing ADA-compliant openers',
      'public works heavy-duty hollow metal needing replacement',
    ],
  },
};

// === SEGMENT-SPECIFIC CTAs (resource-framed, not meeting-asking) ===
export const RESOURCE_CTAS = {
  default: "Just wanted to make sure you know we're here as a resource — no need to act on anything. If something on your facility needs attention, happy to take a look anytime.",
  K12: "Just wanted to be a name you recognize when something comes up — propped door, broken closer, mid-year hardware failure. If anything's already on your radar, happy to walk it with you.",
  HigherEd: "Just wanted to be a name you recognize when something comes up across the campus — turn-season rekeys, opener failures, code questions. If anything's active, happy to walk it with you.",
  LocalGov: "Just wanted to be a name you recognize when something comes up across your facilities — public-facing high-traffic doors, audit exposure, capital planning questions. If anything's active, happy to walk it with you.",
};

// === SANDLER COACH CONTENT ===
export const PAIN_FUNNEL_TEMPLATES = {
  level1: { // Surface symptoms — open the conversation
    title: 'Level 1 — Surface',
    purpose: 'Open the conversation. Get them talking about what they\'re seeing.',
    questions: [
      'Tell me more about what you\'re running into on the door side?',
      'Can you walk me through a recent example?',
      'How long has that been a problem?',
      'What have you tried to do about it so far?',
      'Did what you tried work?',
    ],
  },
  level2: { // Business impact — make the cost real
    title: 'Level 2 — Business Impact',
    purpose: 'Quantify the cost of the problem in business terms before discussing price.',
    questions: [
      'How much do you think that has cost you so far — dollars, time, both?',
      'What does an unplanned door failure during the school year actually cost in disruption?',
      'When that happens, who else gets pulled in — your team, leadership, vendors?',
      'How does this affect your ability to plan capital vs. operating spend?',
      'What\'s the impact on staff or operations when a high-traffic door is down?',
    ],
  },
  level3: { // Emotional / political — uncover the real driver
    title: 'Level 3 — Emotional / Political',
    purpose: 'Surface the personal or political stakes. This is where deals actually move.',
    questions: [
      'How do you feel about how much this is costing — financially or in time?',
      'Who else in your organization is aware of this? Are they bought in to fixing it?',
      'How does the parent / board / leadership reaction land when it happens?',
      'Have you given up trying to deal with this through your current setup?',
      'What happens if you do nothing — this year, next year?',
    ],
  },
};

export const UFC_TEMPLATES = {
  preCall: `Looking forward to our call on {date}. Quick framing so we both get the most out of it:

PURPOSE: Get to know your facility, what's working, what's not, and whether SHP might be a fit.
YOUR TIME: I have us down for {duration} minutes — does that still work?
WHAT I'LL ASK: Mostly questions about your buildings and what you're seeing on the door side.
OUTCOME: At the end, we'll either agree it makes sense to keep talking (probably a quick site walk) or we'll agree it's not a fit right now. Both are good outcomes.

Sound fair?

— Anthony`,
  preSiteWalk: `Quick note before our walk-through on {date}:

PURPOSE: Walk the facility together so I can see what you're seeing — high-traffic doors, anything aging, anything you've been meaning to address.
TIME: Plan on {duration}. If we go shorter, we go shorter.
WHAT I'LL DO: Ask questions, take notes and a few photos with your permission, flag what I see.
OUTCOME: After the walk, I'll send you a priority overview — what's fine, what to monitor, what's worth planning to replace. No proposal unless you ask for one.

If anything changes on your end, just let me know.

— Anthony`,
  preProposalReview: `Looking forward to walking through the proposal on {date}. To make sure we use the time well:

PURPOSE: Review what I'm proposing, answer your questions, and figure out whether this is a yes, a no, or a "yes with changes."
WHAT YOU'LL GET FROM ME: Walk-through of the priorities, the budget ranges, and the phasing recommendation.
WHAT I'LL ASK YOU: Whether this fits your operational reality and budget timing — and if not, what we'd need to change.
OUTCOME: At the end we'll have a clear next step — move forward, revise, or part as friends. All three are fine.

Sound good?

— Anthony`,
};

export const REVERSING_RESPONSES = {
  'send me some info': {
    pattern: 'Send me some info / send me a brochure / let me see what you have',
    reversal: `Happy to. Quick question first so I'm not flooding your inbox with stuff that doesn't matter — what's the part you're trying to get a handle on? Hardware standards, planning approach, pricing reference, or something else?`,
    why: 'Forces specificity. "Send info" is usually a polite brush-off; if they actually need something specific, this surfaces it. If they go silent, you have your answer without having sent anything.',
  },
  'let me think about it': {
    pattern: 'Let me think about it / let me circle back / I need to consider',
    reversal: `Totally fair. What's the part that needs more thought — the timing, the approach, who else needs to be involved, or something else?`,
    why: 'Distinguishes a real "I need to consult" from a soft no. Real considerers will tell you what they\'re weighing; soft no\'s will go vague.',
  },
  'we are all set': {
    pattern: 'We are all set / we have a vendor / we have a guy',
    reversal: `Got it — wouldn't be trying to replace anyone. Out of curiosity, who handles it now, and how's it going? I ask because sometimes facilities teams have a primary plus a backup for when their first call is tied up — totally fine if you don't.`,
    why: 'Acknowledges the existing relationship (no pressure), then opens a small door for a backup-vendor role. Anthony is often the second call, not the first.',
  },
  'no budget right now': {
    pattern: 'No budget / not in this year\'s budget / budget is tight',
    reversal: `Understood. When you do plan capital for doors and hardware, what does that cycle look like — annual, biannual, project-based? I ask so I know whether to circle back in 3 months or 9.`,
    why: 'Reframes "no budget today" into a planning conversation. Gets you on the right cadence instead of a generic follow-up.',
  },
  'reach out next quarter': {
    pattern: 'Reach out next quarter / call me in a few months',
    reversal: `Will do. Two questions so the next call is useful: first, what would have to be true by then for this to be worth a real conversation? And second, anything between now and then that should bump it up — a project, a budget event, an incident?`,
    why: 'Tests whether "next quarter" is real or a polite delay. Real prospects will tell you the conditions; polite-no will repeat the deflection.',
  },
  'not the right person': {
    pattern: 'I\'m not the right person / wrong contact / talk to facilities',
    reversal: `Appreciate you saying so. Who would you point me to? And — if you don't mind — would you be okay with me using your name when I reach out, or would you rather I come in cold?`,
    why: 'Standard Sandler internal-referral move. The name attachment 5x\'s reply rates compared to cold-cold.',
  },
};

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

  // Pull the suggested opener out so we can require it loudly. When research is
  // present, this opener is grounded in real web-searched facts and is the
  // single most important thing the email should contain.
  const hasRealHook = !!(research?.openingHook && research.specificityRating !== 'low');

  return `You are drafting a cold email FROM ${SHP_IDENTITY.rep} (${SHP_IDENTITY.title} at ${SHP_IDENTITY.company}, ${SHP_IDENTITY.hq}, est. ${SHP_IDENTITY.founded}) TO ${prospect.name}, ${prospect.title} at ${prospect.company}.

═════ PROSPECT CONTEXT ═════
Name: ${prospect.name}
Title: ${prospect.title}
Company: ${prospect.company}
Segment: ${segment}
Location: ${prospect.city}, ${prospect.county || ''} County

═════ RESEARCH ═════
${hasRealHook
  ? `OPENING HOOK (use this — it's grounded in real research and is the single most important sentence in this email):
"${research.openingHook}"

Open the body with this hook (you may lightly adjust phrasing to match Anthony's voice, but keep the specific fact intact). DO NOT replace it with a generic "I got your name while wandering your website" opener — the whole point of researching this prospect was to surface this hook.`
  : `Opening hook (generic — research found nothing specific, so frame humbly): ${research?.openingHook || `${prospect.company} operates in ${segment}`}`}

Pain signals: ${research?.painSignals?.join('; ') || 'general facilities pain'}
Company snapshot: ${research?.companySnapshot || ''}
Specificity: ${research?.specificityRating || 'unknown'}${research?.specificityNote ? ` — ${research.specificityNote}` : ''}

═════ AVAILABLE PROOF POINTS (real SHP customers, ranked by relevance to this prospect) ═════
${proofText}

USE 1-2 OF THE ABOVE if (and only if) it fits naturally. Don't force a name drop. Never list more than 2. Never use names that aren't on the above list. If none fit naturally, use generic framing like "we work with multiple ${segment.toLowerCase()} partners across Central Florida."

═════ VOICE GUIDE — FOLLOW THIS EXACTLY ═════
${VOICE_GUIDE}

═════ ANTHONY'S REAL EMAIL EXAMPLES — match this voice ═════
${voiceExamples}

═════ STRUCTURE FOR YOUR DRAFT ═════
1. Opener — ${hasRealHook
   ? `lead with the OPENING HOOK from the research above. That specific fact is what justifies this email being personalized rather than spray-and-pray. You may adjust the wording slightly to fit Anthony's voice (humble, peer-tone, no exclamation points), but the concrete fact MUST appear in the first 1-2 sentences.`
   : `disarming, not salesy. Examples Anthony actually uses:
   - "I got your name while wandering [their site/area]..."
   - "I hope email is OK. I did not want to interrupt your day with a phone call..."
   - "I am reaching out for a quick introduction..."
   Pick whichever fits the situation.`}
2. Humble framing — acknowledge they likely have a vendor: "I know you likely have someone for what we do, but..." OR if research surfaced something specific, lead with that and skip this beat.
3. SHP intro + capability summary — one sentence about who SHP is and what we cover. Keep it tight.
4. Optional proof drop — if a proof point fits naturally (1-2 names max).
5. Soft CTA — borrow from: ${cta}
6. Optional in-person offer — "I'm often in the area with a few customers" — only if prospect is in CFL North.
7. Soft opt-out — REQUIRED. Include this exact line (or a very close paraphrase that keeps the same meaning) on its own paragraph BEFORE the sign-off:
   "${softOptOut}"
   This protects domain reputation by giving recipients a friction-free way to decline instead of marking us as spam. Don't soften it past recognizability.
8. Sign-off and signature.

═════ HARD RULES ═════
- 110-160 words in the body (Anthony's real emails run longer than the previous tight 80-110)
- NO exclamation points
- NO corporate filler ("hope this finds you well", "wanted to reach out", "circle back", "leverage", "synergy")
- Use sentence case in subject line
- Subject line should sound human, not marketing-y. Examples that work: "quick intro from SHP", "hardware partner for [their company]", "a name to know for door work"
- The signature MUST appear verbatim with the physical postal address — required by US CAN-SPAM Act.

═════ SIGNATURE ═════
End the body with this exact signature block:

${signature || DEFAULT_SIGNATURE}

═════ OUTPUT ═════
Return ONLY this JSON, no preamble, no markdown:
{"subject":"...","body":"full body with \\n line breaks, including the signature"}`;
}

// === FOLLOW-UP CADENCE ===
export const FOLLOW_UP_DAYS = 14; // Day 14 = resource-framed long game

// === PIPEDRIVE LEAD/DEAL TITLE FORMAT ===
export function buildDealTitle(prospect, segment) {
  return `${prospect.company} — ${segment} — Outbound Resource Intro`;
}

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
