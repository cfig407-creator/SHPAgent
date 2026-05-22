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
// PR1 scope: identity + brand + defaults only. Voice/territory/ICP/etc.
// still live in strategy.js for now; they migrate in PR2.

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
};
