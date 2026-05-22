// Business profile: Superior Hardware Products (SHP)
// ────────────────────────────────────────────────────────────────────
// All tenant-specific identity, brand, and defaults live here so the
// engine code (strategy.js, OutboundAgent.jsx) stays vertical-agnostic.
//
// To add a new tenant:
//   1. Copy this file to ./acme.js (or whatever tenant id)
//   2. Edit each section's values for that business
//   3. Add it to ./index.js's PROFILES map
//   4. Set VITE_BUSINESS_PROFILE=acme in the tenant's Vercel project
//
// Full tenant content lives here: identity, brand, defaults, customer
// proof points, voice (banks + guide + examples), territory (counties,
// zip/city maps), ICP rules, pain library, Sandler templates, cadence.
// The engine in strategy.js reads from this profile and exposes the
// historical export names for backward compat with the React UI.

export default {
  // ── Tenant metadata ──────────────────────────────────────────────
  meta: {
    id: 'shp',
    name: 'Superior Hardware Products',
    vertical: 'commercial-door-hardware',
    region: 'CFL North',
  },

  // ── Sender identity ──────────────────────────────────────────────
  // The rep's actual contact info; surfaces in signatures, email
  // From: headers, and the app's Pipedrive connection display.
  identity: {
    rep: 'Anthony Koscielecki',
    title: 'Regional Sales Consultant',
    company: 'Superior Hardware Products',
    directPhone: '407-725-8744',
    officePhone: '407-339-6800',
    email: 'anthony@superiorhardwareproducts.com',
    contactCardUrl: 'https://dot.cards/anthonyshp',
    founded: 1986,
    hq: 'Longwood, FL',
    // CAN-SPAM (15 U.S.C. 7704) requires a valid physical postal
    // address in every commercial email.
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
  },

  // ── Brand (UI surface) ───────────────────────────────────────────
  // What the user sees in the app shell — header text, logo letters,
  // primary color. Per .impeccable.md: SHP red is "a scalpel, not a
  // paint roller" — used sparingly for CTAs and brand moments.
  brand: {
    appName: 'Outbound Agent',
    appSubtitle: 'CFL NORTH · v3',
    logoText: 'SHP',
    primaryColor: '#C8102E',         // SHP red
    primaryColorSoft: '#FDEEF0',
    voiceWords: ['direct', 'dependable', 'regional'],
  },

  // ── Default config values ────────────────────────────────────────
  // Used when a fresh user has no saved config in localStorage / KV.
  // The user can override any of these in Settings.
  defaults: {
    signature: `Anthony Koscielecki
Regional Sales Consultant

Direct: 407-725-8744
Office: 407-339-6800
Email: anthony@superiorhardwareproducts.com

Save my contact card: https://dot.cards/anthonyshp

Superior Hardware Products · Longwood, FL`,
    // Soft opt-out: included in every cold email so recipients can
    // decline without filing a spam complaint (which damages domain rep).
    softOptOut: `If doors and hardware aren't on your radar, just let me know and I'll close the loop on my end.`,
    // Touch cap: stop emailing after this many sends with no reply
    // unless the user explicitly overrides per-prospect.
    maxTouches: 3,
  },

  // ── Cadence ──────────────────────────────────────────────────────
  // Days from initial send to the long-game break-up follow-up. Used
  // by buildColdEmailPrompt to schedule the day-N nudge in Pipedrive.
  followUpDays: 14,

  // ── Customer proof points ────────────────────────────────────────
  // Used by pickProofPoints() to inject 2-3 contextually relevant
  // customer references into the email. Score = same-county + same-
  // segment + revenue. named=true means the name can appear in body text.
  customers: [
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
  ],

  // ── Voice content ────────────────────────────────────────────────
  // Everything about HOW the rep writes emails. The composer (in
  // strategy.js) and the AI prompt builder (buildColdEmailPrompt)
  // both consume this. Each variant has metadata (`when`, `requires`,
  // `avoidWhen`) that pickVariant() uses to choose contextually.
  voice: {
    // Example emails — fed into the AI prompt as reference for tone +
    // structure variety. The AI is told to match these without quoting.
    examples: [
      {
        context: 'Short, direct intro — three paragraphs, capability first',
        body: `I'm Anthony with Superior Hardware Products in Longwood. Our team handles everything in your doorways — mechanical hardware, electrified access control integration, closers, panic devices, and service when something fails mid-year.

We're proud to work with multiple [match-segment-or-region peers] across Central Florida. Wanted to put SHP on your radar in case anything comes up — propped door, broken closer, access control tie-in. If anything's already pending, happy to walk it with you.

I'm often in the area with a few customers, so I can stop by for an in-person intro if you'd prefer.`,
      },
      {
        context: '"Found you on website" framing — four paragraphs, humble frame leads the body',
        body: `I got your name while looking for the right facilities contact at [company]. Wanted to put Superior Hardware Products on your radar.

I know you likely have someone for what we do, but in case you need another arrow in your quiver — we handle everything related to your door openings, from mechanical to electrified to automatics. We can provide, service, and install anything related to doors or hardware.

Let me know if the timing is right for a conversation, or if there's another person I should reach out to.

I'm often in the area with a few customers, so I can stop by for an in-person intro if you'd prefer.`,
      },
      {
        context: 'Two-paragraph punch — no capability laundry list, resource frame dominant',
        body: `Quick intro from Superior Hardware Products in Longwood. We're a 40-year shop that handles commercial doors and hardware across Central Florida — from a single broken closer to a master key rebuild across multiple buildings.

I know you likely have a vendor for this. Wanted to be a name you know in case they're ever tied up or it's worth having options. Happy to connect whenever it makes sense, or just file this for when something comes up.`,
      },
      {
        context: 'Proof-point-first structure — same-segment customer anchors the opening body paragraph',
        body: `I'm Anthony with Superior Hardware Products. We work with [Customer A] and [Customer B] in the area and wanted to reach out to [company] as well.

Our team handles everything on the door side — hardware, closers, access control integration, automatics, and service. One call covers it regardless of brand or age of the hardware.

I am sure you already have a resource for this. Just wanted to make sure you knew we operated in your area.`,
      },
      {
        context: 'Geography-anchor opener — county or region as the reason for reaching out',
        body: `We've been working with a few [segment type] clients in [county] County and came across [company] — figured it was worth a quick intro.

Superior Hardware Products handles commercial doors and hardware from end to end: mechanical, electrified access control, automatics, and service when something goes down mid-year. No need to manage three different vendors for door problems.

I am sure you already have someone for this. Wanted to be on your list in case it's useful.`,
      },
      {
        context: 'Short resource-frame — three tight paragraphs, humble frame leads',
        body: `I got your name while looking for the right facilities contact at [company]. Wanted to introduce Superior Hardware Products briefly.

I know you likely have someone for door and hardware work. We're based in Longwood and cover Central Florida — mechanical hardware, access control, automatics, and service. Wanted to be another option if you ever need a second call or your current vendor is backed up.

Let me know if the timing is right for a quick conversation. If not, happy to just be a name on your list.`,
      },
    ],

    // Voice guide — the canonical rules-of-the-road for cold-email tone.
    // Fed into the AI prompt verbatim. Read it carefully before editing
    // — small changes cascade across every generated email.
    guide: `
ANTHONY'S VOICE — characteristics the draft must hit:

1. HUMBLE-CONFIDENT FRAMING. Acknowledge they probably have a vendor before pitching. Phrases like:
   - "I know you likely have someone for what we do, but..."
   - "I am sure you already have a resource, but..."
   - "Wanted to ask if it was worth the time for an intro to have another arrow in the quiver"

2. RESOURCE-FRAMED, NOT MEETING-DEMANDING. Don't ask for a meeting outright. Position SHP as a resource they can lean on:
   - "Wanted to put SHP on your radar in case anything comes up"
   - "If anything's active, happy to walk it with you"
   - "Let me know if the timing is right for a conversation"
   - AVOID: "a name to know" / "name you recognize" — flagged as spam by enterprise filters (Barracuda rejected one of our sends for this phrasing).

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

8. OPENER STYLE — SHORT AND DIRECT.
   DO NOT open with a question. DO NOT open with a preamble apology.
   The opener is a brief introduction of who you are. Two to three sentences max.
   Get to who SHP is and why we're writing without beating around the bush.

   PREFERRED openers (any of these patterns):
   - "Hi {firstName}, I'm Anthony with Superior Hardware Products in Longwood..."
   - "Hi {firstName}, quick intro from Superior Hardware Products..."
   - "Hi {firstName}, I got your name while looking for the right facilities
      contact at {company}. Wanted to put SHP on your radar..."

   FORBIDDEN openers:
   - Leading question: "How are you currently managing..." — feels prosecutorial
   - Long preamble: "I hope email is OK. I did not want to interrupt your day
      with a phone call, so I wanted to send a quick note..." — wastes their time
   - Apologies: "Sorry for the cold reach..." — don't apologize for doing the job
   - Stalker disclosures: "I noticed your portfolio is 400+ buildings..." — kills trust

9. RESEARCH IS BACKGROUND, NOT THE OPENER.
   Research tells you which segment-specific capabilities to emphasize and which
   proof points to surface — it's never the subject of the email. The prospect
   doesn't need to know we did research. They need to know what we do and that
   we work with peers like them.

10. VARY THE STRUCTURE. No two cold emails should feel like the same template
    filled in differently. Vary paragraph count (2–4), vary what leads, vary
    sentence rhythm. Sometimes proof comes before capability. Sometimes the
    humble frame is the first thing after the greeting. Sometimes the intro
    and capability are one sentence. Sometimes there is no in-person offer.
    The voice examples show different structures — use the full range.
`,

    // === OPENER BANK ===
    // Picks one based on context (geography match, title altitude, etc.)
    openerBank: [
      {
        id: 'A_workhorse',
        when: 'default — works for any cold outreach',
        text: `I got your name while looking for the right facilities contact at {company}. Wanted to put Superior Hardware Products on your radar.`,
      },
      {
        id: 'B_quick_intro',
        when: 'default — punchy alternative, no "looking for" framing',
        text: `Quick intro from Superior Hardware Products in Longwood. Wanted to get on your radar.`,
      },
      {
        id: 'C_geography',
        when: 'fires when there\'s a same-county customer to anchor on',
        text: `We've been working with a few clients in {county} County and came across {company} — figured it was worth a quick introduction.`,
        requires: ['sameCountyCustomer'],
      },
      {
        id: 'D_peer_anchor',
        when: 'fires when proof points exist — leads with the peer reference',
        text: `SHP has been supporting {proof} and a few other partners in the area. Wanted to reach out to {company} as well.`,
        requires: ['hasProofPoints'],
      },
      {
        id: 'E_plain_intro',
        when: 'default — clean self-intro, no "I got your name" framing',
        text: `I'm Anthony with Superior Hardware Products — we handle commercial doors and hardware across Central Florida and wanted to introduce ourselves to {company}.`,
      },
      {
        id: 'F_higher_altitude',
        when: 'fires for Director / VP / Superintendent / decision-maker titles',
        text: `I was looking for the right facilities contact at {company} and your name came up. Wanted to introduce SHP briefly.`,
        requires: ['strategicTitle'],
      },
    ],

    // === BODY BANK ===
    // Humble-confident framing + capability + optional proof drop.
    // {proof} placeholder gets replaced with a contextual customer reference.
    // `avoidWhen` flags let the composer skip variants in inappropriate contexts.
    bodyBank: [
      {
        id: 'B1_humble_capability',
        when: 'default — humble framing + capability, with optional proof drop',
        text: `I know you likely have a vendor for this. Wanted to be another option in case something comes up — a broken closer mid-year, access control that needs hardware to match, or a bigger project where you want a second call.

We handle everything from mechanical hardware and closers to electrified access control and automatic doors. One call, regardless of brand or age of the hardware.{proof}`,
      },
      {
        id: 'B2_proof_anchor_natural',
        when: 'fires when proof points exist — natural peer reference, no corporate-speak',
        text: `We work with {proofList} across Central Florida, and I wanted to make sure {company} knew we were operating in the area.

On the door and hardware side, we handle it end to end — mechanical, electrified access control, automatics, and service when something fails. One number regardless of brand or age.`,
        requires: ['hasProofPoints'],
      },
      {
        id: 'B3_capability_focused',
        when: 'fires when proof points are weak or absent — leads with capability',
        text: `We cover the full door opening — hollow metal and wood doors, closers, panic devices, access control hardware, and automatics. Everything we supply, we also install and service.

We're based in Longwood and work primarily with school systems, municipalities, colleges, and healthcare facilities across Central Florida.{proof}`,
      },
      {
        id: 'B4_forty_year_resource',
        when: 'fires when prospect appears to need broad capability awareness',
        text: `We're a 40-year family shop in Longwood. Commercial doors and hardware is all we do — mechanical, electrified access control, and automatics — and we handle installation and service ourselves.

I know you likely have a vendor for this. Just wanted to be another name on your list in case you ever need a second option or your current vendor is tied up.{proof}`,
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
        when: 'shortest variant — minimal, punchy. Avoid for high-altitude titles.',
        text: `We handle commercial doors and hardware across Central Florida — mechanical closers, access control hardware, automatic openers, and service. One call for any doorway issue, regardless of brand.{proof}

I know you likely have someone for this. Wanted to be on your list in case it's ever useful.`,
        avoidWhen: ['strategicTitle'], // too thin for Directors/VPs
      },
    ],

    // === CTA BANK ===
    // Soft CTAs in Anthony's voice. Composer rotates based on context.
    ctaBank: [
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
        text: `Wanted to put SHP on your radar in case anything comes up — propped door, broken closer, mid-year hardware failure. If anything's already pending, happy to walk it with you.`,
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
    ],

    // === FULL EMAIL BANK ===
    // Complete 2–3 paragraph email bodies (greeting and signature are added
    // by the composer). The composer tries this bank first; falls back to
    // the 3-part assembly only if no FULL_EMAIL_BANK variant is eligible.
    fullEmailBank: [
      {
        id: 'FE1_resource_frame',
        when: 'default — 2 tight paragraphs, humble frame, no proof needed',
        text: `I'm Anthony with Superior Hardware Products in Longwood. We handle commercial doors and hardware across Central Florida — mechanical closers, access control hardware, automatics, and service when something fails mid-year.

I know you likely have a vendor for this. Wanted to be a name you know in case something comes up or it's worth having a second option. Happy to connect whenever it makes sense, or just file this away for later.`,
      },
      {
        id: 'FE2_geography_anchor',
        when: 'fires when there is a same-county customer to anchor on',
        requires: ['sameCountyCustomer'],
        text: `We've been working with a few clients in {county} County and came across {company} — figured it was worth a quick intro.

Superior Hardware Products handles commercial doors and hardware from end to end: mechanical, electrified access control, automatics, and service when something goes down mid-year. One call regardless of brand or age of the hardware.

I'm sure you already have someone for this. Wanted to be on your list in case it's ever useful.`,
      },
      {
        id: 'FE3_proof_anchor',
        when: 'fires when proof points exist — leads with the named peer reference',
        requires: ['hasProofPoints'],
        text: `I'm Anthony with Superior Hardware Products. We work with {proofList} in the area and wanted to reach out to {company} as well.

On the door and hardware side, we cover it end to end — mechanical hardware, access control tie-ins, automatic openers, and service. One call handles it regardless of brand or age.

I'm sure you already have a resource for this. Just wanted to make sure you knew we were in your area.`,
      },
      {
        id: 'FE4_forty_year_punch',
        when: 'default — 2 paragraphs, 40-year shop anchor, resource frame',
        text: `Quick intro from Superior Hardware Products in Longwood. We're a 40-year shop that handles commercial doors and hardware across Central Florida — from a single broken closer to master key rebuilds across multi-building portfolios.

I know you likely have a vendor for this. Wanted to be a name you know in case they're ever backed up or it's worth having options. Happy to connect whenever it makes sense, or just keep this around for when something comes up.`,
      },
      {
        id: 'FE5_capability_first',
        when: 'default — leads with capability breadth, 2 tight paragraphs',
        text: `I'm Anthony with Superior Hardware Products, based in Longwood. We handle the full door opening for commercial facilities — hollow metal and wood doors, closers, panic devices, access control hardware, and automatics. Everything we supply, we also install and service.

I know you likely have a vendor for this. Wanted to be another name on your list. If anything's active on the door or hardware side, happy to take a look.`,
      },
      {
        id: 'FE6_proof_list_leads',
        when: 'fires when proof points exist — proof list anchors the opening line',
        requires: ['hasProofPoints'],
        text: `SHP works with {proofList} across Central Florida. Wanted to reach out to {company} and make sure you knew we were in the area.

We handle doors and hardware from end to end — mechanical closers, electrified access control, automatics, and service when something fails. One number regardless of brand or building age.

I'm sure you already have someone for this. Just wanted to be on your list in case you need a second option.`,
      },
    ],

    // === SUBJECT LINE BANK ===
    // All sentence-case (filters distrust all-lowercase) and clear of cold-
    // email clichés ("a name to know", "name you recognize") that Barracuda
    // and similar enterprise filters score as bulk-prospecting.
    subjectBank: [
      'Quick intro from SHP — {company}',
      'Door & hardware support for {company}',
      'Hardware partner for {company}',
      'SHP — local door & hardware supplier',
      'Introducing Superior Hardware Products',
      '{firstName} — quick intro from SHP',
      'Local door & hardware support in {county}',
      'Door work at {company} — quick intro',
      'SHP — door & hardware coverage in Central Florida',
      'Quick note from Superior Hardware Products',
    ],
  },

  // ── Territory ────────────────────────────────────────────────────
  // Geographic scope: the rep's covered region, the counties they
  // touch, and the city/zip → county maps used to classify prospect
  // location during CSV imports and Apollo searches. Engine builds
  // Apollo location strings from CITY_TO_COUNTY at runtime.
  territory: {
      name: 'CFL North End User',
      counties: [
        'Duval', 'St. Johns', 'Clay', 'Nassau', 'Alachua',
        'Marion', 'Volusia', 'Seminole', 'Flagler', 'Lake', 'Sumter',
        'Putnam', 'Hernando', 'Citrus', 'Orange',
      ],
    },

  zipToCounty: {
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
},

  cityToCounty: {
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
},

  // ── ICP segmentation rules ───────────────────────────────────────
  // Title-ladder for multi-thread coverage at known orgs. Tiers 1-4
  // map frontline → strategic. ADJACENT_FUNCTIONS catch decision-
  // adjacent purchasing roles (procurement, safety, security).
  // FACILITIES_KEYWORDS feeds Apollo's title-keyword search; broad
  // matching captures everyone with the keyword in their title.
  icp: {
    titleLadder: {
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
},
    adjacentFunctions: [
  'Director of Procurement', 'Procurement Manager', 'Purchasing Manager',
  'Director of Safety', 'Safety Manager', 'Director of Security',
  'Director of Capital Projects', 'Construction Manager', 'Project Manager Construction',
  'Director of Risk Management',
],
    facilitiesKeywords: [
  // Core facilities + maintenance
  'Facilities', 'Facility',
  'Maintenance',
  // Plant operations — common in higher ed + manufacturing
  'Plant Operations', 'Plant Manager', 'Plant Director',
  'Plant',
  'Physical Plant',
  // Buildings & grounds — K-12 and university lexicon
  'Buildings and Grounds', 'Buildings & Grounds',
  // Operations & maintenance combo (O&M)
  'Operations and Maintenance',
  // Custodial / grounds
  'Custodial', 'Grounds',
  // Adjacent purchasing-decision roles
  'Procurement', 'Purchasing',
  'Safety',
  'Security',
  'Capital Projects', 'Construction',
],
  },

  // ── Pain library + segment-specific resource CTAs ───────────────
  // Used by the AI prompt builder to surface relevant pain signals.
  // Strategic = capital-planning level; tactical = day-to-day ops.
  painLibrary: {
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
},

  resourceCtas: {
  default: "Wanted to make sure you know we're here as a resource — no need to act on anything. If something on your facility needs attention, happy to take a look anytime.",
  K12: "Wanted to put SHP on your radar in case anything comes up — propped door, broken closer, mid-year hardware failure. If anything's already pending, happy to walk it with you.",
  HigherEd: "Wanted to put SHP on your radar across the campus mix — turn-season rekeys, opener failures, code questions. If anything's active, happy to walk it with you.",
  LocalGov: "Wanted to put SHP on your radar across your facilities — public-facing high-traffic doors, audit exposure, capital planning questions. If anything's active, happy to walk it with you.",
},

  // ── Sandler Coach content (warm conversation, post-reply) ───────
  // Used by the Coach view when a prospect replies. Pain Funnel
  // questions, UFC scripts, and Reversing responses. Currently tenant-
  // flavored (door/hardware examples) but the structure transfers
  // cleanly to any consultative B2B sales motion.
  sandler: {
    painFunnel: {
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
},
    ufc: {
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
},
    reversing: {
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
},
  },
};
