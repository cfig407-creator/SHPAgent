// Shared Vercel KV (Upstash Redis) helpers.
// ────────────────────────────────────────────────────────────────────
// Underscore-prefixed file: Vercel excludes this from function routing
// (does NOT count against the 12-function cap on Hobby plan). Every
// /api/*.js endpoint that needs KV imports from here instead of
// duplicating the helpers locally.
//
// Why this exists:
//   Before this module, kvGet/kvSet/kvDel were copy-pasted into 6 api
//   files (~150 lines of duplication). Adding TTL, atomic ops, or
//   migrating to a different KV provider meant touching all 6 files.

export function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

const HEADERS = () => ({
  Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
});
const HEADERS_JSON = () => ({
  ...HEADERS(),
  'Content-Type': 'application/json',
});

// ── String (key → JSON value) ───────────────────────────────────────
export async function kvGet(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: HEADERS(),
  });
  if (!r.ok) return null;
  const json = await r.json();
  if (!json?.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

export async function kvSet(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: HEADERS_JSON(),
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV set ${r.status}`);
}

export async function kvDel(key) {
  await fetch(`${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: HEADERS(),
  });
}

// ── List operations (atomic, for race-free appends) ─────────────────
// Returns { ok, wrongType?, error? } so callers can detect legacy
// string-format keys and migrate them.
export async function kvRPushRaw(key, ...values) {
  const body = JSON.stringify(values.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
  const r = await fetch(`${process.env.KV_REST_API_URL}/rpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: HEADERS_JSON(),
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok: false, wrongType: /wrongtype/i.test(text), error: text };
  }
  return { ok: true };
}

export async function kvLRange(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/lrange/${encodeURIComponent(key)}/0/-1`, {
    headers: HEADERS(),
  });
  if (!r.ok) return [];
  const json = await r.json();
  const items = Array.isArray(json?.result) ? json.result : [];
  return items.map(s => { try { return JSON.parse(s); } catch { return s; } });
}

export async function kvLTrim(key, start, stop) {
  await fetch(`${process.env.KV_REST_API_URL}/ltrim/${encodeURIComponent(key)}/${start}/${stop}`, {
    method: 'POST',
    headers: HEADERS(),
  });
}

// Atomic append + trim. Uses Upstash pipeline so both ops are sent in
// one request (still not strictly atomic at the Redis level — pipeline
// can be interleaved with other connections — but eliminates the
// network round-trip race we had with separate calls).
export async function kvRPushAndTrim(key, value, keepLast) {
  const body = JSON.stringify([
    ['RPUSH', key, typeof value === 'string' ? value : JSON.stringify(value)],
    ['LTRIM', key, `-${keepLast}`, '-1'],
  ]);
  await fetch(`${process.env.KV_REST_API_URL}/pipeline`, {
    method: 'POST',
    headers: HEADERS_JSON(),
    body,
  });
}

// Append to a list with one-time migration support. If the key already
// holds a legacy JSON-string array (from before the atomic-write fix),
// parse + DEL + re-RPUSH all old items + the new one. Subsequent writes
// are pure RPUSH with no migration overhead.
export async function kvSafeAppendList(key, value) {
  const first = await kvRPushRaw(key, value);
  if (first.ok) return;
  if (!first.wrongType) {
    console.warn('[kv] RPUSH failed for', key, '—', first.error?.slice(0, 200));
    return;
  }
  // Legacy format detected. Migrate.
  const oldData = await kvGet(key);
  await kvDel(key);
  if (Array.isArray(oldData) && oldData.length > 0) {
    await kvRPushRaw(key, ...oldData.map(v => (typeof v === 'string' ? v : JSON.stringify(v))));
  }
  await kvRPushRaw(key, value);
}

// ── Hash operations (HSET-style, atomic per-field) ──────────────────
export async function kvHGet(key, field) {
  const r = await fetch(
    `${process.env.KV_REST_API_URL}/hget/${encodeURIComponent(key)}/${encodeURIComponent(field)}`,
    { headers: HEADERS() }
  );
  if (!r.ok) return null;
  const json = await r.json();
  if (!json?.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

export async function kvHSet(key, field, value) {
  const url = `${process.env.KV_REST_API_URL}/hset/${encodeURIComponent(key)}/${encodeURIComponent(field)}`;
  await fetch(url, {
    method: 'POST',
    headers: HEADERS_JSON(),
    body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)),
  });
}

export async function kvHGetAll(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/hgetall/${encodeURIComponent(key)}`, {
    headers: HEADERS(),
  });
  if (!r.ok) return {};
  const json = await r.json();
  // Upstash returns hash as an array of alternating field/value strings
  const arr = Array.isArray(json?.result) ? json.result : [];
  const out = {};
  for (let i = 0; i < arr.length; i += 2) {
    const k = arr[i];
    const v = arr[i + 1];
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
}
