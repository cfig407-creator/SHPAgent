# Multi-Tenant Onboarding

This codebase ships as the same engine to every tenant. Per-tenant differences
(identity, brand, voice, customers, territory, ICP) live in
`src/profiles/{tenantId}.js`. Each tenant gets their own **separate Vercel
project** with their own KV instance, Azure App Registration, Apollo API key,
etc. — no cross-tenant data bleed is possible because everything is isolated
at the project level.

## What's tenant-specific

| Category | Lives in profile | Notes |
|---|---|---|
| Identity (rep name, phones, address) | ✅ | Used in signatures and `From:` headers |
| Brand (app name, logo letters, color) | ✅ | UI shell — header, primary color |
| Default signature + soft opt-out + touch cap | ✅ | Seed values for fresh users |
| Customer proof points | ⏳ PR2 | Will move from `strategy.js` into profile |
| Voice guide + email banks + subject bank | ⏳ PR2 | Will move from `strategy.js` into profile |
| Territory (counties, city/zip maps) | ⏳ PR2 | Will move from `strategy.js` into profile |
| ICP rules (segments, title ladder, keywords) | ⏳ PR2 | Will move from `strategy.js` into profile |
| Pain library + resource CTAs | ⏳ PR2 | Will move from `strategy.js` into profile |
| Follow-up cadence (days) | ⏳ PR2 | Will move from `strategy.js` into profile |

PR1 has only the simplest extractions wired up. PR2 will move the bulk
content. Until PR2 ships, only the SHP profile actually works end-to-end —
other tenants would need to override the constants in `strategy.js` directly.

## What's NOT tenant-specific (shared engine)

These stay in shared code regardless of tenant:

- Email pattern detection (`detectEmailPattern`, `guessEmailForName`)
- Org name normalization (`normalizeOrgKey`)
- HTML scraper + NDR parser
- M365 OAuth flow + send + bounce check
- Apollo proxy (enrich, people-search, org-search, quota)
- Pipedrive proxy
- Open-tracking pixel + polling
- Rate-limit handling, retry logic
- All UI components

## Onboarding a new tenant (procedure)

### Step 1 — Create the profile file

```bash
cp src/profiles/shp.js src/profiles/acme.js
```

Edit every section in `acme.js` for the new business:

- `meta.id` — short identifier matching the filename (`acme`)
- `meta.name` / `meta.vertical` / `meta.region` — descriptive
- `identity.*` — the actual rep contact info
- `brand.*` — app name, logo text, primary color
- `defaults.signature` — multi-line, CAN-SPAM-compliant (must include physical address)
- `defaults.softOptOut` — opt-out language in their voice
- `defaults.maxTouches` — touch cap

### Step 2 — Register the profile in `src/profiles/index.js`

```js
import shp from './shp.js';
import acme from './acme.js';        // ← add this

const PROFILES = {
  shp,
  acme,                                // ← add this
};
```

### Step 3 — Create a new Vercel project

1. Go to `vercel.com/new` → Import this same GitHub repo
2. Project name: `acme-outbound-agent` (or similar)
3. **Before deploying**, add env vars:

   | Name | Value | Notes |
   |---|---|---|
   | `VITE_BUSINESS_PROFILE` | `acme` | Must match the filename in src/profiles |
   | `PIPEDRIVE_API_TOKEN` | tenant's PD token | Their own Pipedrive |
   | `PIPEDRIVE_DOMAIN` | `their.pipedrive.com` | |
   | `ANTHROPIC_API_KEY` | shared OR per-tenant | Recommend per-tenant for billing |
   | `APOLLO_API_KEY` | shared OR per-tenant | Same |
   | `KV_REST_API_URL` | new Upstash KV | New per-tenant DB |
   | `KV_REST_API_TOKEN` | matching KV token | |
   | `MS_CLIENT_ID` | new Azure App Registration | Per-tenant |
   | `MS_TENANT_ID` | new | |
   | `MS_CLIENT_SECRET` | new | |
   | `APP_URL` | `https://acme.vercel.app` | Their deployed URL |
   | `PIXEL_BASE_URL` | `https://track.acme.com` | Same-domain pixel for deliverability |

4. Deploy. Open the URL. Header should say their brand name + logo letters.

### Step 4 — Set up Azure (per-tenant)

Each tenant needs their own Microsoft App Registration:

1. Azure portal → App registrations → New registration
2. Name: `Acme Outbound Agent`
3. Redirect URI: `https://acme.vercel.app/api/ms-auth-callback`
4. API permissions: `Mail.Send`, `Mail.Read`, `User.Read`, `offline_access`
5. Grant admin consent
6. Create client secret, copy value into `MS_CLIENT_SECRET`
7. Copy Application (client) ID into `MS_CLIENT_ID`
8. Copy Directory (tenant) ID into `MS_TENANT_ID`

### Step 5 — Set up Upstash KV (per-tenant)

Each tenant gets their own KV database for full data isolation:

1. Vercel project → Storage → Create Database → KV
2. Copy the `KV_REST_API_URL` and `KV_REST_API_TOKEN` into the tenant's env vars

### Step 6 — Set up the same-domain tracking pixel subdomain (optional but recommended)

Big deliverability win — see `superiorhardwareproducts.com` notes elsewhere
in the repo. Each tenant should configure `track.{their-domain}` as a CNAME
to their Vercel deployment, and set `PIXEL_BASE_URL` to that subdomain.

## Coming in PR2

- Voice / territory / ICP / customers all move into the profile
- A `src/profiles/_template.js` skeleton with TODO markers for every required field
- Validation: the engine throws at startup if a required profile field is missing

Until PR2, creating a new tenant means editing `strategy.js` constants in
addition to the profile. PR2 makes `src/profiles/acme.js` self-sufficient.
