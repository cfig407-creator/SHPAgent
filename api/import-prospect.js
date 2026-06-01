// Inbound prospect intake from ICP Scout (and any future upstream sourcer).
// ────────────────────────────────────────────────────────────────────
// ICP Scout discovers + vets decision-makers, then hands the approved ones
// here. They land in a durable server-side inbox (Vercel KV). The SHP
// frontend reads the inbox on load and merges any it hasn't already
// consumed into the rep's prospect pool, where outbound drafting +
// Pipedrive push already live. We do NOT push to Pipedrive here.
//
// Durability model (deliberately NON-destructive):
//   • POST appends to a capped KV list (last 200), deduped by stable id.
//   • GET returns the full inbox WITHOUT deleting it. The reader is the
//     authority on what it has already consumed (it tracks consumed ids in
//     its own localStorage), so a read that fails to persist never loses a
//     record, and a re-push is harmless.
// An earlier version drained on read; that lost prospects when a read
// didn't reach the UI, and the idempotency gate then refused to re-queue.
//
// Auth: shared secret in X-Internal-API-Key, matched to INTERNAL_API_KEY.
// The SAME value must be set on the ICP Scout side and here.
//
//   POST /api/import-prospect   { idempotency_key, organization, person, deal, metadata }
//                               → { ok, prospect_id, idempotency_replayed }
//   GET  /api/import-prospect   → { prospects: [...], count }

import { kvAvailable, kvLRange, kvRPushAndTrim } from './_kv.js';
import { requireAppKey } from './_auth.js';

const INBOX_KEY = 'shp:import:inbox:v2';
const KEEP_LAST = 200;

const memory =
  globalThis.__shpImportMemory || (globalThis.__shpImportMemory = { inbox: [] });

export default async function handler(req, res) {
  // POST (an upstream sourcer writing in) requires the server-to-server shared
  // secret INTERNAL_API_KEY. GET (the browser frontend reading its inbox)
  // returns prospect PII, so it now requires the app key (X-SHP-Key) — it was
  // previously open, leaking the whole inbox to anyone with the URL.
  if (req.method === 'POST') {
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (!expectedKey) {
      return res.status(500).json({
        error: 'INTERNAL_API_KEY not set in Vercel environment variables',
      });
    }
    const provided = req.headers['x-internal-api-key'];
    if (provided !== expectedKey) {
      return res.status(401).json({ error: 'invalid or missing X-Internal-API-Key' });
    }
    return handlePost(req, res);
  }
  if (req.method === 'GET') {
    if (!requireAppKey(req, res)) return;
    return handleGet(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function readInbox(usingKv) {
  return usingKv ? await kvLRange(INBOX_KEY) : [...memory.inbox];
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
  const prospect = mapToShpProspect({ key, organization, person, deal, metadata });

  // Dedup by stable id against the inbox itself — the single source of
  // truth. A re-push of the same prospect is acknowledged, not duplicated.
  const inbox = await readInbox(usingKv);
  if (inbox.some((p) => p?.id === prospect.id)) {
    return res.status(200).json({
      ok: true,
      prospect_id: prospect.id,
      idempotency_replayed: true,
    });
  }

  if (usingKv) {
    await kvRPushAndTrim(INBOX_KEY, prospect, KEEP_LAST);
  } else {
    memory.inbox.push(prospect);
    if (memory.inbox.length > KEEP_LAST) {
      memory.inbox = memory.inbox.slice(-KEEP_LAST);
    }
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
  const prospects = await readInbox(usingKv);
  return res.status(200).json({
    prospects,
    count: prospects.length,
    persisted: usingKv,
  });
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
    // replay maps to the same record on both sides.
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
