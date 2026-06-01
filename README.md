# SHP Outbound Agent v3

AI-powered prospecting tool for Superior Hardware Products. Three ICPs (K-12 Education, Higher Education, Local Government) across the CFL North 15-county territory. Resource-framed cold outreach + Sandler Coach for warm conversations.

## What's in v3

- **Six views**: Dashboard · Find · Clusters · Pipeline · Coach · Settings
- **602 seed prospects** loaded from your master list (FLDOE Private Schools, IFMA Florida, N CFL Cities, TIPS)
- **Three ICP detection**: auto-classifies prospects, hard-skips healthcare/industrial/retail/multi-site CRE/residential/hospitality
- **Density clustering**: 2+ ready prospects in a county = trip-worthy cluster, ranked by trip score
- **Apollo cluster-aware search** across all 15 counties + **Manual Add** for prospects Apollo misses
- **v2 cold email tone**: resource-framed, "be a name you recognize," not Sandler-pattern
- **Pipedrive integration**: serverless proxy bypasses CORS, creates Person + Org + Deal + Day-14 follow-up activity
- **Sandler Coach**: Pain Funnel prep cards (3 levels), UFC scripts, Reversing helpers — for after they reply
- **Sender identity**: Anthony Koscielecki, 407-725-8744, anthony@superiorhardwareproducts.com

## Architecture

- **Frontend**: React + Vite SPA (`src/SHPProspectingAgent.jsx` + `src/strategy.js`)
- **Strategy module** (`src/strategy.js`) — separated so ICP, pain libraries, Sandler templates can be updated without touching UI
- **Seed data** (`src/seed-prospects.js`) — your 602-row master list, embedded as an ES module export
- **Backend**: 11 Vercel serverless functions in `api/` (plus two non-routed `_`-prefixed helper modules). **The project runs on the Vercel Hobby plan, which caps deployments at 12 functions — there is one slot of headroom.** Add new capability by folding it into an existing function via an `?action=` sub-route (as `apollo.js` and `ms-send.js` already do), NOT by adding a new top-level `api/*.js`.

  | Function | Purpose |
  |---|---|
  | `anthropic.js` | Proxy to Anthropic Messages API (research, drafting, scrape extraction). App-key gated. |
  | `apollo.js` | Consolidated Apollo proxy — `?action=enrich\|people-search\|org-search\|quota`. App-key gated. |
  | `pipedrive.js` | Pipedrive REST proxy (CORS bypass) for find/dedup/create. |
  | `config.js` | Sender-identity / settings persistence (Vercel KV). |
  | `import-prospect.js` | Inbound prospect intake from ICP Scout. POST = `INTERNAL_API_KEY`; GET (inbox read) = app-key gated. |
  | `ms-auth.js` / `ms-auth-callback.js` | Microsoft 365 OAuth (Graph) connect flow. |
  | `ms-send.js` | M365 send via Graph (embeds open-tracking pixel) + `?action=check-bounces` NDR scan. |
  | `opens.js` | Read open-tracking events. App-key gated. |
  | `pixel.js` | 1×1 tracking-pixel beacon. **Public by design** (mail clients load it). |
  | `scrape-url.js` | SSRF-hardened server-side fetch for directory scraping. |
  | `_kv.js` / `_auth.js` | Shared helpers (KV access, app-key check). Not routed; don't count against the cap. |

- **External APIs**: Anthropic API (research + drafting + HTML extraction), Apollo REST (enrich/search), Pipedrive REST (CRM), Microsoft Graph (M365 send + bounce detection), Vercel KV / Upstash Redis (tokens, open-tracking, bounces).
- **Send paths**: M365 one-click tracked send (primary), Pipedrive Compose (fallback), Outlook deeplink (fallback).

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "v3 — Sandler Coach + Three ICPs + Density Clusters"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shp-outbound-agent.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your repo
3. Vercel auto-detects Vite — leave defaults
4. **Before clicking Deploy**, add Environment Variables. See `.env.example` for the full annotated list. Summary:

   **Core (required for the named feature):**
   - `ANTHROPIC_API_KEY` — research + drafting (proxied through `/api/anthropic`)
   - `APOLLO_API_KEY` — enrich + search (proxied through `/api/apollo?action=...`)
   - `PIPEDRIVE_API_TOKEN` — CRM push
   - `PIPEDRIVE_DOMAIN` (optional) — e.g. `superiorhardware.pipedrive.com`
   - `KV_REST_API_URL` + `KV_REST_API_TOKEN` — Vercel KV. Required for M365 tokens, open-tracking, and bounce storage. Without them, settings still fall back to `localStorage`.

   **Microsoft 365 send + bounce tracking:**
   - `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET` — Azure App Registration (Graph `Mail.Send` + `Mail.Read`)
   - `APP_URL` — deployment base URL (e.g. `https://shp-agent.vercel.app`). Set explicitly so OAuth redirect + pixel URLs don't rely on a spoofable host header.
   - `PIXEL_BASE_URL` (optional) — same-root-domain pixel host (e.g. `https://track.superiorhardwareproducts.com`) for better deliverability.

   **App-key gate (browser-facing endpoints):**
   - `SHP_API_KEY` (runtime) + `VITE_SHP_API_KEY` (build) — **set both to the same value.** Gates `anthropic`, `apollo`, `opens`, and `import-prospect` GET against drive-by abuse. If unset, the gate stays dormant (app works, but those endpoints are open).

   **ICP Scout integration (only if used):**
   - `INTERNAL_API_KEY` — shared secret for `import-prospect` POST. The endpoint 500s without it.

   **Optional hardening:**
   - `SCRAPE_SECRET`, `BOUNCE_CHECK_SECRET` — when set, require `X-Shp-Secret` on `scrape-url` / `check-bounces`.
5. Deploy. ~60 seconds.

### 3. First load

- Open your URL
- Header should show "Pipedrive · Anthony Koscielecki" green within a second
- Settings → paste Smart BCC, save
- You're done. Hit **Find** to start.

## Updating the strategy

The whole strategy lives in `src/strategy.js`:
- ICP definitions (K-12, Higher Ed, Local Gov)
- City → County map (15 CFL North counties)
- Pain libraries (strategic + tactical for each segment)
- Resource CTAs
- Sandler templates (Pain Funnel, UFC, Reversing)
- Cold email prompt builder

Update there, commit, and Vercel auto-redeploys. No UI changes needed.

## Updating seed prospects

Edit `src/seed-prospects.js` (an ES module exporting the array). Each record needs: `id`, `name`, `title`, `company`, `email`, `phone`, `city`, `county`, `state`, `zip`, `segment`, `status`, `priority`, `source`.

## Token security

- All server-side API tokens (`PIPEDRIVE_API_TOKEN`, `ANTHROPIC_API_KEY`, `APOLLO_API_KEY`, `MS_CLIENT_SECRET`, `INTERNAL_API_KEY`, `KV_*`) live in Vercel env vars only — never in the frontend or browser.
- Anthropic, Apollo, and Pipedrive calls go through serverless proxies (`/api/anthropic`, `/api/apollo?action=...`, `/api/pipedrive`).
- **App-key gate:** the browser-facing proxies (`anthropic`, `apollo`, `opens`, `import-prospect` GET) require an `X-SHP-Key` header matching `SHP_API_KEY`. Because the SPA ships the key in its bundle (`VITE_SHP_API_KEY`), this is a speed-bump against drive-by abuse, **not** a vault. The real billing backstop for the LLM/Apollo proxies is the **Anthropic monthly spend cap** (set in `console.anthropic.com`) — configure it.
- M365 OAuth tokens + open-tracking + bounces persist in Vercel KV; sender identity syncs to KV when configured (otherwise `localStorage`).
- If a token is compromised: rotate in the originating system, update the Vercel env var, redeploy. Rotating `SHP_API_KEY` requires updating both `SHP_API_KEY` and `VITE_SHP_API_KEY` and redeploying.

## Reliability

- All external API calls (Pipedrive, Apollo, Anthropic) retry transient failures (5xx, 429, network errors) with exponential backoff (up to 2 retries by default — see `src/api-client.js`)
- Each call is bounded by a timeout (30s for Pipedrive/Apollo, 90s for Anthropic web search) so the UI never hangs forever
- The dashboard surfaces the *current* connection state — no stale "disconnected" banner once a connect succeeds

## Data export

Settings → "Data Export" downloads a JSON snapshot of your config, prospect overrides, Pipedrive record IDs, and cached research. Useful for backups or migrating to a new browser.
