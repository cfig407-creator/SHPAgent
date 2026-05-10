# SHP Outbound Agent — Project Notes for Claude Code

## What this is
A single-tenant outbound prospecting tool built for Anthony Koscielecki, Regional Sales Consultant at Superior Hardware Products (Longwood, FL). Covers the 15-county CFL North Florida territory across three core ICPs: K-12 Education, Higher Education, Local Government — with healthcare as the only auto-skip.

## Architecture quick-reference
- **Frontend**: React 18 + Vite SPA. Most logic lives in `src/SHPProspectingAgent.jsx` (~2,400 lines, monolithic on purpose for now). Strategy/voice/ICP rules live in `src/strategy.js`.
- **Backend**: Vercel serverless functions in `api/` — `pipedrive`, `apollo-enrich`, `apollo-people-search`, `apollo-quota`, `anthropic`, `config`.
- **Data**: 647 seed prospects in `src/seed-prospects.js`. Per-prospect overrides + cycle tracking persist to `localStorage`. Sender identity also syncs to Vercel KV when configured.
- **Reusable scripts**: `scripts/import-ifma-jax.mjs` (xlsx → seed appender), `scripts/reclassify-seed.mjs` (re-runs ICP classifier on the seed pool).

## Design Context

### Users
**Anthony Koscielecki** — Regional Sales Consultant at SHP, working the 15-county CFL North Florida territory. Single-tenant: this app is built for him.

**Context of use (split):**
- Desktop, between calls — laptop/large monitor at his desk for research, drafting, pushing leads to Pipedrive, reviewing the kanban pipeline
- Mobile, in the field — phone in his truck or on a job site for quick prospect lookups, copy-paste contact info, marking outcomes after meetings

**Job to be done:** Move cold prospects through outreach → research → personalized email → Pipedrive lead → site walk → deal as efficiently as possible.

### Brand Personality
**Three words: direct, dependable, regional.**

- **Direct** — SHP doesn't talk in marketing speak. The cold-email voice guide bans corporate filler. The interface should match: no fluff, no fake encouragement.
- **Dependable** — 40 years in business (since 1986). Family-owned. Aesthetic should feel earned and stable, not trendy.
- **Regional** — Central Florida specifically. Geographic-pride is a real lever (the trip-score clusters are the heart of the app).

### Aesthetic Direction
**Light theme** primary. Bright, daylit, professional. **SHP red `#C8102E`** stays as the primary brand color, used sparingly.

**Reference points:** Pipedrive / HubSpot for familiar CRM patterns; Linear / Height for restraint and typographic hierarchy.

**Anti-references:** AI-design slop (dark cyan/purple gradients, gradient text, glassmorphism, side-stripe colored borders); B2B SaaS templates (identical card grids, hero metric tiles); agency portfolio (maximalist type, scroll-triggered reveals); tech-bro mono everything.

### Design Principles
1. **Function never bends to form.** Every visual change preserves existing behavior. Not one feature regresses.
2. **Density with rhythm.** Pipedrive-level density, broken with intentional whitespace where decisions happen.
3. **SHP red is a scalpel, not a paint roller.** Used at moments of action, never as gradient fill or decorative borders.
4. **Mobile is a translation, not an amputation.** Field flows (Find list, prospect card, cluster drill-in) get first-class mobile treatment.
5. **No AI tells.** Deliberate decisions, not Claude's defaults.

For the full design context, see `.impeccable.md` in the project root.

## Conventions
- Inline `style={{...}}` is the current pattern — there's a `makeStyles()` factory at the bottom of the agent file. Phase 1 of the design refresh introduces a CSS-variable design token layer that lives alongside it without breaking inline styles.
- All external API calls go through `src/api-client.js` (timeout + retry on 5xx/429/network).
- Don't hardcode the Anthropic model name — use the `ANTHROPIC_MODEL` constant at the top of `SHPProspectingAgent.jsx`.

## Don't
- Don't push to `main` without a build passing locally first.
- Don't introduce Inter, DM Sans, IBM Plex, Outfit, Plus Jakarta, Instrument Sans/Serif, Space Grotesk, Cormorant, or Fraunces. They're all banned per the brand voice.
- Don't add glassmorphism, gradient text, or side-stripe colored borders. They're AI-design tells.
- Don't break existing localStorage keys (`shp_config_v3`, `shp_prospect_overrides_v3`, `shp_apollo_cycle_v1`).
