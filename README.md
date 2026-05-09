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
- **Seed data** (`src/seed-prospects.json`) — your 602-row master list, embedded
- **Backend**: One Vercel serverless function at `/api/pipedrive` proxying Pipedrive API server-side (required to bypass CORS)
- **External APIs**: Anthropic API (research + drafting), Apollo MCP (prospect search), Pipedrive REST API (CRM), Gmail (mailto compose)

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
4. **Before clicking Deploy**, add Environment Variables:
   - `PIPEDRIVE_API_TOKEN` — your Pipedrive personal API token
   - `PIPEDRIVE_DOMAIN` (optional) — e.g. `superiorhardware.pipedrive.com`
   - `ANTHROPIC_API_KEY` — required for prospect research + Apollo MCP search (calls now go through `/api/anthropic`, not directly from the browser)
   - `APOLLO_API_KEY` — required for `/api/apollo-enrich` and `/api/apollo-quota`
   - `KV_REST_API_URL` + `KV_REST_API_TOKEN` (optional) — enables server-side persistence of sender identity / settings via Vercel KV. Without these, settings still save to `localStorage` and the app keeps working.
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

Replace `src/seed-prospects.json` with a new export. Each record needs: `id`, `name`, `title`, `company`, `email`, `phone`, `city`, `county`, `state`, `zip`, `segment`, `status`, `priority`, `source`.

## Token security

- All API tokens (`PIPEDRIVE_API_TOKEN`, `ANTHROPIC_API_KEY`, `APOLLO_API_KEY`) live in Vercel env vars only — never in the frontend or browser
- Anthropic, Apollo, and Pipedrive calls all go through serverless proxies (`/api/anthropic`, `/api/apollo-enrich`, `/api/apollo-quota`, `/api/pipedrive`)
- Smart BCC and sender identity sync to Vercel KV when configured (otherwise `localStorage`)
- If a token is compromised: rotate in the originating system, update the Vercel env var, redeploy

## Reliability

- All external API calls (Pipedrive, Apollo, Anthropic) retry transient failures (5xx, 429, network errors) with exponential backoff (up to 2 retries by default — see `src/api-client.js`)
- Each call is bounded by a timeout (30s for Pipedrive/Apollo, 90s for Anthropic web search) so the UI never hangs forever
- The dashboard surfaces the *current* connection state — no stale "disconnected" banner once a connect succeeds

## Data export

Settings → "Data Export" downloads a JSON snapshot of your config, prospect overrides, Pipedrive record IDs, and cached research. Useful for backups or migrating to a new browser.
