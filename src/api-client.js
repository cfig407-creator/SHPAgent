// Tiny fetch wrapper used by every external API call in the app.
// - Retries transient failures (network errors, 5xx) with exponential backoff
// - Special-cases 429 rate-limit responses: long backoff (45-60s) since
//   Anthropic's limit is per-minute. The previous 600ms-2.4s backoff was
//   useless against a per-minute window.
// - Times out long-running requests
// - Returns parsed JSON; throws an Error with a useful message on failure

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2; // 1 initial + 2 retries = 3 attempts total
const BACKOFF_BASE_MS = 600;
const RATE_LIMIT_BACKOFF_MS = 45_000; // 45s — enough to clear most per-minute windows

function isRetryable(status) {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
}

function isRateLimit(status, body) {
  if (status === 429) return true;
  const msg = typeof body === 'string' ? body
    : (body?.error?.message || body?.error || body?.message || '');
  return typeof msg === 'string' && /rate.?limit|exceed.*rate|tokens per minute|tpm/i.test(msg);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// App key attached to every same-origin /api call so the browser-facing
// endpoints (anthropic, apollo, opens, import-prospect GET) can gate out
// drive-by abuse. Sourced from VITE_SHP_API_KEY at build time. If unset,
// no header is sent and the server-side gate stays dormant — see api/_auth.js.
const APP_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SHP_API_KEY) || '';

// Header helper for raw fetch() calls that don't go through apiFetch (e.g.
// the opens poll and import-prospect inbox read, which do bespoke response
// handling). Spread into their headers so they carry the app key too.
export function appKeyHeader() {
  return APP_KEY ? { 'X-SHP-Key': APP_KEY } : {};
}

export async function apiFetch(url, options = {}, opts = {}) {
  const {
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    parseJson = true,
  } = opts;

  // Inject the app-key header on same-origin /api requests (not absolute URLs
  // to third parties). Merges with any caller-supplied headers.
  const isLocalApi = typeof url === 'string' && url.startsWith('/api/');
  const mergedHeaders = isLocalApi && APP_KEY
    ? { ...(options.headers || {}), 'X-SHP-Key': APP_KEY }
    : options.headers;
  if (mergedHeaders) options = { ...options, headers: mergedHeaders };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      // Try to inspect body for rate-limit signals even on non-2xx
      let bodyPeek = null;
      if (!r.ok) {
        try { bodyPeek = await r.clone().text(); } catch { /* ignore */ }
      }

      if (!r.ok && isRetryable(r.status) && attempt < retries) {
        // Use long backoff for rate-limit errors, short for generic 5xx
        const rateLimited = isRateLimit(r.status, bodyPeek);
        const retryAfterHeader = parseInt(r.headers.get('retry-after') || '0', 10);
        const wait = rateLimited
          ? (retryAfterHeader > 0 ? retryAfterHeader * 1000 : RATE_LIMIT_BACKOFF_MS)
          : BACKOFF_BASE_MS * Math.pow(2, attempt);
        // Fire a DOM event so the UI can show a "retrying in N seconds" toast.
        // The main component listens for this and surfaces user-friendly status.
        if (rateLimited && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('shp:rate-limit-retry', {
            detail: { waitMs: wait, attempt: attempt + 1, url },
          }));
        }
        await sleep(wait);
        continue;
      }

      let body;
      if (parseJson) {
        const text = bodyPeek != null ? bodyPeek : await r.text();
        try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      } else {
        body = bodyPeek != null ? bodyPeek : await r.text();
      }

      if (!r.ok) {
        const msg = body?.error?.message || body?.error || body?.message || `HTTP ${r.status}`;
        const err = new Error(typeof msg === 'string' ? msg : `HTTP ${r.status}`);
        err.status = r.status;
        err.body = body;
        err.rateLimit = isRateLimit(r.status, body);
        throw err;
      }

      return body;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError';
      const isNetwork = err.name === 'TypeError'; // browser fetch network failure
      const transient = isAbort || isNetwork || isRetryable(err.status || 0);
      if (transient && attempt < retries) {
        lastErr = err;
        const rateLimited = err.rateLimit || isRateLimit(err.status || 0, err.body);
        const wait = rateLimited
          ? RATE_LIMIT_BACKOFF_MS
          : BACKOFF_BASE_MS * Math.pow(2, attempt);
        if (rateLimited && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('shp:rate-limit-retry', {
            detail: { waitMs: wait, attempt: attempt + 1, url },
          }));
        }
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('apiFetch failed without error');
}

// Convenience wrapper for POST JSON
export function postJson(url, body, opts) {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts);
}
