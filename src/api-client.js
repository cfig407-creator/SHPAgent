// Tiny fetch wrapper used by every external API call in the app.
// - Retries transient failures (network errors, 5xx, 429) with exponential backoff
// - Times out long-running requests
// - Returns parsed JSON; throws an Error with a useful message on failure

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2; // 1 initial + 2 retries = 3 attempts total
const BACKOFF_BASE_MS = 600;

function isRetryable(status) {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function apiFetch(url, options = {}, opts = {}) {
  const {
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    parseJson = true,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (!r.ok && isRetryable(r.status) && attempt < retries) {
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      let body;
      if (parseJson) {
        const text = await r.text();
        try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      } else {
        body = await r.text();
      }

      if (!r.ok) {
        const msg = body?.error?.message || body?.error || body?.message || `HTTP ${r.status}`;
        const err = new Error(typeof msg === 'string' ? msg : `HTTP ${r.status}`);
        err.status = r.status;
        err.body = body;
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
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
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
