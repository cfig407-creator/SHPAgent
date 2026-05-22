// Active business profile selector.
// ────────────────────────────────────────────────────────────────────
// Each tenant deployment sets VITE_BUSINESS_PROFILE in their Vercel
// env vars (e.g. VITE_BUSINESS_PROFILE=shp). The engine reads from
// the matching profile here. If unset (e.g. local dev), defaults to
// SHP so nothing breaks.
//
// To onboard a new tenant:
//   1. Create ./{tenantId}.js (copy ./shp.js as template)
//   2. Import + register it below
//   3. Set VITE_BUSINESS_PROFILE={tenantId} in their Vercel project
//
// Each tenant is a SEPARATE Vercel project with its own KV instance,
// its own Azure App Registration, its own env vars. No cross-tenant
// data bleed possible because everything is isolated at the project
// level.

import shp from './shp.js';

const PROFILES = {
  shp,
  // acme: acmeProfile,    // add new tenants here
};

const activeId = import.meta.env?.VITE_BUSINESS_PROFILE || 'shp';
const profile = PROFILES[activeId];

if (!profile) {
  // Fail loud at module load so deploys with a typo don't ship broken.
  throw new Error(
    `Unknown VITE_BUSINESS_PROFILE: "${activeId}". ` +
    `Known profiles: ${Object.keys(PROFILES).join(', ')}.`
  );
}

export default profile;
