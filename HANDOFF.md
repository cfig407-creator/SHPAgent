# SHP Outbound Agent — Session Handoff

Drop this into the next session as: *"Read HANDOFF.md, CLAUDE.md, and `.impeccable.md` before touching anything."*

---

## 1. Project at a Glance

**What it is:** Single-tenant outbound prospecting tool for **Anthony Koscielecki**, Regional Sales Consultant at **Superior Hardware Products** (Longwood, FL, est. 1986). Covers the 15-county CFL North Florida territory across three ICPs: K-12 Education, Higher Education, Local Government — with **healthcare as the only auto-skip** (everything else commercial is in-ICP).

**Deployed at:** https://shp-agent.vercel.app · **GitHub:** [cfig407-creator/SHPAgent](https://github.com/cfig407-creator/SHPAgent) · auto-deploys from `main` on every push.

**User identity (Anthony):**
- Email: `anthony@superiorhardwareproducts.com`
- Phone: 407-725-8744 direct / 407-339-6800 office
- Contact card: https://dot.cards/anthonyshp
- **Target outbound volume:** 25–75/day

---

## 2. Architecture (Where Things Live)

```
shp-outbound-agent/
├── api/                            ← Vercel serverless functions
│   ├── anthropic.js                ← Anthropic Messages API proxy (server-side key)
│   ├── apollo-enrich.js            ← Apollo people-match (1 credit per hit)
│   ├── apollo-people-search.js     ← Apollo mixed_people/search (paid only)
│   ├── apollo-org-search.js        ← Apollo mixed_companies/search (paid only)
│   ├── apollo-quota.js             ← Free-tier returns nulls, see "Known Quirks"
│   ├── config.js                   ← Vercel KV config sync (GET/POST)
│   └── pipedrive.js                ← Pipedrive REST proxy
├── scripts/                        ← One-shot tools (reusable)
│   ├── import-ifma-jax.mjs         ← XLSX → seed importer (idempotent)
│   ├── reclassify-seed.mjs         ← Re-runs ICP classifier on seed
│   ├── _token-migrate.mjs          ← Phase-1 color migration (idempotent)
│   ├── _responsive-classes.mjs     ← Phase-2 className adder (idempotent)
│   └── _ifma_jax_raw.json          ← Gitignored intermediate
├── src/
│   ├── SHPProspectingAgent.jsx     ← Monolith (~3,800 lines) — all views + handlers
│   ├── strategy.js                 ← Voice, ICP, proof points, prompts (~1,200 lines)
│   ├── seed-prospects.js           ← 647 prospects (auto-generated from master list)
│   ├── api-client.js               ← fetchWithRetry helper (timeout + backoff)
│   └── main.jsx                    ← React entry
├── public/
├── index.html                      ← Loads Hanken Grotesk + JetBrains Mono
├── CLAUDE.md                       ← Project conventions
├── .impeccable.md                  ← Design context
└── HANDOFF.md                      ← This file
```

**Frontend stack:** React 18 + Vite. Inline styles (CSS-in-JS), all themed via CSS variables in `<GlobalStyles>`. **No CSS framework.** **No Tailwind.** Don't add either.

**Anthropic model:** `claude-sonnet-4-5` (stable alias, defined as `ANTHROPIC_MODEL` constant near top of `SHPProspectingAgent.jsx`).

---

## 3. Environment Variables (Vercel)

| Var | Required? | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Required** | Research + AI email drafting |
| `APOLLO_API_KEY` | **Required** | Enrichment + (paid-plan) search |
| `PIPEDRIVE_API_TOKEN` | **Required** | CRM integration |
| `PIPEDRIVE_DOMAIN` | Optional | Falls back to `api.pipedrive.com` |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Optional | Vercel KV for cross-device settings sync. **Set via Upstash** (not Vercel's native KV — Vercel deprecated it). |

---

## 4. Persistence Keys (localStorage)

| Key | Shape | Notes |
|---|---|---|
| `shp_config_v3` | sender identity + email hygiene + Apollo cap | Also syncs to Vercel KV when configured |
| `shp_prospect_overrides_v3` | `{[prospectId]: { outreachStatus, revisitDate, deletedAt }}` | Status flips (Customer / Dead / Pursue Later) |
| `shp_pd_records_v1` | `{[prospectId]: { leadId, dealId, sentAt, sentHistory[], touchCount }}` | Pipedrive links + touch counter |
| `shp_apollo_cycle_v1` | `{ cycle: '2026-05', creditsUsedThisCycle, lastUpdated }` | Auto-rotates on new month |

**Don't break these keys** — Anthony has live data in production localStorage.

---

## 5. What's Already Shipped (DO NOT REBUILD)

In rough chronological order. Most recent first.

### Email & Voice
- ✅ AI-drafted cold emails via `buildColdEmailPrompt` (claude-sonnet-4-5)
- ✅ Voice guide encoded in `VOICE_GUIDE` + 3 few-shot `VOICE_EXAMPLES` in strategy.js
- ✅ **Anti-stalker policy (latest):** research is *background only*, never quoted. Opener is a **short direct intro** (no questions, no "I hope email is OK" preamble). Forbidden-phrases list in the prompt.
- ✅ Email hygiene: CAN-SPAM physical address auto-appended to signature, soft opt-out line, touch cap (default 3)
- ✅ Outlook deeplink send (`outlook.office.com/mail/deeplink/compose?...`) — M365↔Pipedrive sync auto-logs

### Apollo
- ✅ Enrichment (`/api/apollo-enrich`) — works on free tier, 1 credit per match
- ✅ Multi-thread Find Peers (per-prospect peer search) — **paid plan only**
- ✅ Bulk Cross-Thread pool (60 orgs in one click) — **paid plan only**
- ✅ Find New Accounts (org search + chained people search) — **paid plan only**
- ✅ Batch Enrich wizard ("Spend remaining credits" end-of-cycle workflow)
- ✅ **Search in Apollo** deep-link button → opens Apollo web UI with criteria pre-filled (works on free tier)
- ✅ City-level location filter (166 CFL North cities) — Apollo's county geocoder was unreliable
- ✅ Email-availability filter (verified / extrapolated_verified / likely_to_engage)
- ✅ Apollo cycle tracker with auto-rotation on month boundary

### CSV Import
- ✅ Find → **Import CSV** tab with drag-drop file picker
- ✅ Inline RFC-4180 CSV parser (no library dependency)
- ✅ Auto-detect column mapping (First Name, Last Name, Company, Email, etc.)
- ✅ Live preview with classifyCounty + classifyICP applied
- ✅ De-dupes against existing pool by normalized name+company

### Territory
- ✅ 647 seed prospects (602 original + 45 from IFMA JAX import)
- ✅ `CITY_TO_COUNTY` map (~166 cities)
- ✅ `ZIP_TO_COUNTY` map (~350 zips) for CSV fallback when city missing
- ✅ `classifyCounty(city, zip)` accepts both inputs
- ✅ `APOLLO_LOCATION_STRINGS` (city-level, derived from CITY_TO_COUNTY)

### Pipedrive
- ✅ Push as Lead (Person + Org + Lead + Day-14 follow-up activity)
- ✅ Live pipeline kanban
- ✅ Connection status badge with stale-error fix

### Reliability
- ✅ `apiFetch` / `postJson` in `src/api-client.js` — timeout + exponential backoff
- ✅ All external calls (Pipedrive, Apollo, Anthropic) go through it
- ✅ Plan-tier detection on Apollo search endpoints (`error: 'apollo_plan_required'`) — bulk loops short-circuit instead of wasting 60 round-trips

### Design
- ✅ Phase 1: design tokens in CSS variables, light theme primary, Hanken Grotesk + JetBrains Mono, SHP red `#C8102E` used sparingly
- ✅ Phase 2: mobile-responsive shell (header collapses, bottom tab bar, modal bottom-sheets, 44px tap targets)
- ✅ Zero AI design tells (no border-left stripes, no gradient text, no glassmorphism)

### Misc
- ✅ Vercel KV config persistence via `/api/config` (Upstash backend)
- ✅ Data Export button in Settings (downloads JSON snapshot)
- ✅ Pursue Later auto-rotates on `visibilitychange` + 30-min interval
- ✅ "Today at a glance" panel replaced the static "Three Pillars" filler

---

## 6. Pending / Deferred Work

Ordered roughly by leverage. **None of these are in progress** — they're candidates.

### High-leverage (workflow gains)

1. **Bulk actions in Find** — multi-select checkboxes on prospect rows + bulk action bar: *Push N to Pipedrive*, *Mark N as Pursue Later*, *Change status of N*. Turns 20 clicks into 1. CSV importer handles bulk-create; this is bulk-mutate of existing prospects.

2. **Cluster trip planner** — Clusters view has trip scores per county but no batch action. Add "Plan trip to Volusia" → push every prospect in the cluster to PD as a tagged group, optionally schedule Day-14 follow-ups for the same week.

3. **Outreach activity log** — Zero record of historical outreach right now. Add a timeline view showing "researched X Tuesday → pushed PD Wednesday → emailed Thursday → replied Saturday" per prospect. Surface weekly metrics. The `pdRecords` data is already in place; just needs a view component.

4. **Inline Coach panel during Research** — Sandler templates (Pain Funnel, UFC, Reversing) currently live in their own tab. Add a slide-out drawer on the Research view so Anthony can pull them up during a live call without losing context.

5. **AI-assisted reply generation** — When a prospect replies, what's the right reversal/response? Could integrate Sandler templates from `REVERSING_RESPONSES` with AI to draft a context-aware reply.

### Voice & content tightening

6. **Voice training: ingest sent emails** — Currently the AI gets 3 hardcoded `VOICE_EXAMPLES` as few-shot. If we ingest Anthony's last ~20 actually-sent emails (from Pipedrive timeline via API), voice match improves dramatically. Could even auto-update `strategy.js` when patterns shift over time.

7. **Sandler follow-up sequences** — Currently Day-14 activity is generic. Could build out: Day 14 = soft resource share, Day 35 = pain funnel question, Day 70 = "pursue later" trigger. Templates would live in strategy.js.

### Apollo / data quality

8. **Decision: upgrade Apollo to Basic (~$49/mo)?** — Unlocks search endpoints (multi-thread, cross-thread, find-new-accounts all work). Today's free-tier workaround is the CSV import path which works but is slower. Anthony's call.

9. **Batch Apollo enrich on remaining personal emails** — Of the 647 seed prospects, ~168 originally had gmail/yahoo emails (since reduced via use). Could run a one-shot enrich-everything script on a monthly basis to keep the pool clean. Cost: 1 credit per match found.

10. **Apollo CSV mapping templates** — User maps columns manually each import. Save the mapping per source ("Apollo standard", "IFMA roster", "FLDOE export") so repeat imports skip the mapping step.

11. **SHP physical street address** — Settings → Email Hygiene → Company physical address currently defaults to *"Superior Hardware Products · Longwood, FL"*. Anthony should replace with actual street address (CAN-SPAM technically requires it, though city/state is generally accepted as sufficient for B2B).

### Tech debt

12. **Code splitting** — Bundle is now ~600 KB (warning threshold 500). Lazy-import the Coach view, BatchEnrich modal, CSVImportTab, and other low-frequency components. Drops initial load to ~300 KB.

13. **Split the monolith** — `SHPProspectingAgent.jsx` is ~3,800 lines. Per-view file split (DashboardView.jsx, FindView.jsx, ClustersView.jsx, etc.) is purely a refactor — no visible change — but makes future work 3× faster. The render functions are already structured as separate components in one file, just need extraction.

14. **Concurrency limit on Research calls** — Currently nothing stops a user from triggering 100 simultaneous research calls (e.g. if a "Research all" bulk action ever ships). Wrap `researchProspect` in a queue with max 3 concurrent.

15. **Phase 3 design pass** — Component polish:
    - ProspectRow badge cluster gets crowded (Customer + Lead + Sent ×3 + Needs Enrichment all stack)
    - Pipeline stage indicators could use subtle color (segment-derived)
    - Toast positioning could be smarter on mobile
    - Find filters could collapse on mobile

16. **Phase 4 motion sweep** — Single coordinated entry animation per page, gentle list-add/remove transitions. Currently no motion beyond the loading spinner.

---

## 7. Known Quirks & Gotchas

| Quirk | Workaround / Note |
|---|---|
| Apollo's free-tier `/auth/health` returns null usage | `/api/apollo-quota` falls back to local cycle tracker via `effectiveQuota` memo |
| Apollo's free tier rejects `mixed_people/search` and `mixed_companies/search` with `"Invalid access credentials."` | Detected as `error: 'apollo_plan_required'` (HTTP 403); UI suggests CSV import path |
| Apollo's recommendation engine bypasses strict filters when active | Sort overridden to `organization_name` (alphabetical); city-level locations also help |
| Outlook deeplink mangles spaces with URLSearchParams | Build URL manually with `encodeURIComponent` (not URLSearchParams) |
| Email hygiene signature appends address only if missing | Loose substring check; if user manually places city/state in signature, no duplicate |
| Pipedrive lead conversion to deal is manual in PD UI | `pushToPipedrive` creates a Lead in Lead Inbox; user converts when site walk scheduled |
| `Hi Patricia,` greeting uses first name only | Explicit instruction in `buildColdEmailPrompt`; if AI defaults to "Ms. Kahle," refresh once and it self-corrects |

---

## 8. Design Context Reference

**Read `.impeccable.md` for full design context.** Key principles:

- **Direct, dependable, regional** — three brand words
- **Light theme** primary
- **SHP red `#C8102E`** used as a scalpel (primary CTAs, brand mark only — never gradients or borders)
- **Typography:** Hanken Grotesk (UI body) + JetBrains Mono (technical fields). Banned: Inter, DM Sans, IBM Plex, Outfit, Plus Jakarta, Instrument Sans/Serif, Space Grotesk
- **No AI tells:** no glassmorphism, no gradient text, no border-left colored stripes, no rounded-corner icons over every heading
- **Pipedrive/HubSpot familiarity** over Linear-level airiness — Anthony works through 600+ prospects
- **Mobile is a translation, not an amputation** — bottom tab bar, full-width modals, ≥44px tap targets

---

## 9. Voice & ICP Reference (strategy.js)

**Key exports the next session needs to know:**

```js
// strategy.js
SHP_IDENTITY              // rep, title, phones, email, company address, founded, pillars, capabilities
DEFAULT_SIGNATURE         // appended to every cold email, includes physical address (CAN-SPAM)
DEFAULT_SOFT_OPT_OUT      // appears before sign-off in every cold email
DEFAULT_MAX_TOUCHES       // 3 — touch cap for sendViaOutlook
TERRITORY                 // 15 CFL North counties
CITY_TO_COUNTY            // ~166 cities → county map
ZIP_TO_COUNTY             // ~350 zips → county fallback for CSV imports
APOLLO_LOCATION_STRINGS   // city-level Apollo filters (derived from CITY_TO_COUNTY)
APOLLO_COUNTY_LOCATION_STRINGS  // county-level (kept for reference, NOT recommended — unreliable geocoding)
CUSTOMERS                 // proof points for "we work with X" drops
VOICE_EXAMPLES            // 3 few-shot examples (short direct, found-on-website, warm rep intro)
VOICE_GUIDE               // 9 numbered rules including: short opener, no questions, no preamble, no stalker disclosures
PAIN_LIBRARY              // strategic + tactical pains by segment
RESOURCE_CTAS             // soft CTA copy by segment
PAIN_FUNNEL_TEMPLATES     // 3-level Sandler questions (live conversation only — not cold email)
UFC_TEMPLATES             // 3 Up-Front Contract scripts
REVERSING_RESPONSES       // brush-off → reversal patterns

classifyCounty(city, zip) // pass either or both; returns CFL North county name or null
classifyICP(company, title)  // returns { segment, status: 'in' | 'out' | 'unknown' }
classifyTitle(title)      // returns { altitude: 'strategic' | 'tactical' | 'unknown', facilitiesRelevant: bool }
classifyTier(title)       // 1-4 (Frontline / Tactical / Management / Strategic) — used for multi-thread
getMultiThreadTitles(currentTitle, segment)  // returns ladder titles to search for at the same org
pickProofPoints(prospect, max)  // ranked same-segment + same-county customer matches
composeEmail({ prospect, signature, proofPoints, avoid, softOptOut })  // deterministic fallback composer
buildColdEmailPrompt(prospect, research, segment, signature, softOptOut)  // AI prompt builder
buildLeadTitle(prospect, segment)  // Pipedrive lead title format
buildClusters(prospects)  // groups by county, returns clusters w/ trip scores
detectEnrichmentNeeds(prospect)  // returns { needsEnrichment: bool, reasons: [string] }
customerCheck(prospect)   // auto-detects existing customers by org name match
```

**Healthcare is the ONLY auto-skip.** Everything else commercial (industrial, retail, residential, hospitality, multi-site CRE, "Commercial" catch-all) is in-ICP.

---

## 10. Quick-Start Commands for Next Session

```bash
# Working directory
cd "C:/Users/Anthony Millicare/OneDrive - ESB/Desktop/my-projects/SHP Agent/shp-outbound-agent"

# Sync
git pull --ff-only

# Build (verify no regressions)
npm run build

# Dev server
npm run dev    # → http://localhost:5173

# Re-run a one-shot script (idempotent)
node scripts/reclassify-seed.mjs --dry   # preview re-classification
node scripts/reclassify-seed.mjs          # commit it

# Inspect the live config endpoint
curl -s "https://shp-agent.vercel.app/api/config" | jq

# Inspect Apollo quota
curl -s "https://shp-agent.vercel.app/api/apollo-quota" | jq
```

---

## 11. Commit Conventions

- Short title (≤70 chars) summarizing the change
- Body wraps at ~72 chars, explains the *why* and any non-obvious *how*
- Co-author line at end: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` *(skip if user prefers)*
- Don't push to `main` without `npm run build` passing locally
- Don't bypass hooks (`--no-verify`, `--no-gpg-sign`) unless explicitly asked

Reference recent commits for tone — they explain the user-visible behavior change, the technical approach, and what backward-compat was preserved.

---

## 12. How to Pick Up Fast

1. **Read this file, CLAUDE.md, and `.impeccable.md` first.** They're under 1000 lines combined.
2. **`git log --oneline -20`** to see what landed recently.
3. **Look at the live app:** https://shp-agent.vercel.app — Anthony's actual data is in there.
4. **Ask Anthony what's bugging him today.** The pending list above is candidates; his current pain dictates priority.
5. **Before any new feature:** verify `npm run build` is clean on a fresh clone.

The app is stable. Most pending work is additive (features, polish) or refactor (split the monolith). Nothing's currently broken.

---

*Generated at session end on 2026-05-10. Update this file in place whenever the pending list materially changes.*
