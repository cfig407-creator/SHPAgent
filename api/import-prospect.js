// Inbound prospect intake from ICP Scout (and any future upstream sourcer).
// ────────────────────────────────────────────────────────────────────
// ICP Scout discovers + vets decision-makers, then hands the approved ones
// here. They land in a server-side inbox (Vercel KV). The SHP frontend
// drains the inbox on load and merges them into the rep's prospect pool,
// where outbound drafting + Pipedrive push already live. We do NOT push to
// Pipedrive here — that stays a rep-driven action inside the SHP UI.
//
// Auth: shared secret in the X-Internal-API-Key header, matched against
// the INTERNAL_API_KEY env var. The SAME value must be set on the ICP
// Scout side (.env.local INTERNAL_API_KEY) and here (Vercel env).
//
//   POST /api/import-prospect   { idempotency_key, organization, person, deal, metadata }
//                               → { ok, prospect_id, idempotency_replayed }
//   GET  /api/import-prospect   → { prospects: [...], drained: n }   (drains inbox)
//   GET  /api/import-prospect?peek=1 → { prospects, count }          (no drain)
//
// Storage: Vercel KV when configured, else a warm-instance in-memory
// fallback (mirrors config.js). Inbox is a KV list; idempotency is a KV
// hash so a re-pushed prospect doesn't duplicate.

import { kvAvailable, kvGet, kvSet, kvLRange, kvDel, kvSafeAppendList } from './_kv.js';

const INBOX_KEY = 'shp:import:inbox';
const SEEN_KEY = 'shp:import:seen:v1';

const memory =
  globalThis.__shpImportMemory ||
  (globalThis.__shpImportMemory = { inbox: [], seen: {} });

export default async function handler(req, res) {
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (!expectedKey) {
    return res.status(500).json({
      error: 'INTERNAL_API_KEY not set in Vercel environment variables',
    });
  }

  // GET (the frontend draining its inbox) is same-origin and unauthenticated;
  // POST (an upstream sourcer writing in) requires the shared secret.
  if (req.method === 'POST') {
    const provided = req.headers['x-internal-api-key'];
    if (provided !== expectedKey) {
      return res.status(401).json({ error: 'invalid or missing X-Internal-API-Key' });
    }
    return handlePost(req, res);
  }
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handlePost(req, res) {
  const usingKv = kvAvailable();
  const body = req.body || {};
  const { idempotency_key, organization, person, deal, metadata } = body;

  if (!person?.name || !organization?.name) {
    return res.status(400).json({
      error: 'payload requires person.name and organization.name',
    });
  }

  const key = idempotency_key || `auto_${person.name}_${organization.name}`;

  // Idempotency — a re-pushed prospect (same key) is acknowledged, not duplicated.
  const seen = usingKv ? await kvGet(seenKey(key)) : memory.seen[key];
  if (seen) {
    return res.status(200).json({
      ok: true,
      prospect_id: seen.prospect_id,
      idempotency_replayed: true,
    });
  }

  const prospect = mapToShpProspect({ key, organization, person, deal, metadata });

  if (usingKv) {
    await kvSafeAppendList(INBOX_KEY, prospect);
    await kvSet(seenKey(key), { prospect_id: prospect.id, at: prospect.importedAt });
  } else {
    memory.inbox.push(prospect);
    memory.seen[key] = { prospect_id: prospect.id, at: prospect.importedAt };
  }

  return res.status(200).json({
    ok: true,
    prospect_id: prospect.id,
    idempotency_replayed: false,
    imported: true,
  });
}

async function handleGet(req, res) {
  const usingKv = kvAvailable();
  const peek = req.query?.peek === '1' || req.query?.peek === 'true';

  const prospects = usingKv ? await kvLRange(INBOX_KEY) : [...memory.inbox];

  if (!peek && prospects.length > 0) {
    // Drain. Low-volume single-rep tool — a full read-then-clear is fine.
    if (usingKv) await kvDel(INBOX_KEY);
    else memory.inbox = [];
  }

  return res.status(200).json({
    prospects,
    count: prospects.length,
    drained: peek ? 0 : prospects.length,
    persisted: usingKv,
  });
}

function seenKey(key) {
  return `${SEEN_KEY}:${key}`;
}

// Map ICP Scout's {organization, person, deal} into the prospect shape the
// SHP pool expects (see addManualProspect / seed-prospects.js). Unknown
// fields are left blank rather than guessed.
function mapToShpProspect({ key, organization, person, deal, metadata }) {
  const signals = Array.isArray(deal?.signals_matched) ? deal.signals_matched : [];
  const confirmed = signals
    .filter((s) => s?.verdict === 'confirmed' || s?.verdict === 'partial')
    .map((s) => s.id)
    .slice(0, 6);

  const sourceLabel = metadata?.profile_slug
    ? `ICP Scout / ${metadata.profile_slug}`
    : 'ICP Scout';

  return {
    // Stable, dedupe-friendly id derived from the idempotency key so a
    // replay maps to the same record.
    id: `icp_${String(key).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    name: person.name,
    title: person.title || '',
    company: organization.name,
    email: person.email || '',
    phone: person.phone || '',
    linkedinUrl: person.linkedin_url || '',
    address: organization.address?.street || '',
    city: organization.address?.city || '',
    county: organization.admin_unit || '',
    state: organization.state || organization.address?.state || 'FL',
    zip: organization.address?.zip || '',
    segment: organization.vertical || 'Imported',
    status: 'Ready',
    priority: typeof deal?.initial_score === 'number' ? deal.initial_score : 100,
    source: sourceLabel,
    sourceNotes: confirmed.length
      ? `ICP Scout · signals: ${confirmed.join(', ')}`
      : 'Imported from ICP Scout',
    // Traceability — keep the upstream score + email status without polluting
    // the core fields the UI renders.
    icpScout: {
      idempotencyKey: key,
      score: deal?.initial_score ?? null,
      emailStatus: person.email_status ?? null,
      sourceUrl: person.source_url ?? null,
      runId: metadata?.run_id ?? null,
    },
    importedAt: new Date().toISOString(),
  };
}
