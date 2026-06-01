// Shared app-key auth for browser-facing endpoints.
//
// These endpoints (anthropic, apollo, opens, import-prospect GET) are called
// by the SPA from the browser, so they cannot hold a truly-secret credential —
// the key ships in the JS bundle. This check is a strong speed-bump that stops
// drive-by abuse (billing run-up on the LLM/Apollo proxies, PII harvesting on
// opens/import-prospect) by anyone who merely discovers the deployment URL.
// It is NOT a defense against an attacker who reads the bundle. The real
// billing backstop is the Anthropic monthly spend cap (console.anthropic.com).
//
// Server reads SHP_API_KEY (runtime env). Frontend sends X-SHP-Key, sourced
// from VITE_SHP_API_KEY at build time. Set BOTH to the same value in Vercel.
//
// Rollout grace: if SHP_API_KEY is unset, the check passes (so deploying this
// code does not break the live app before the env var is configured). Set
// SHP_API_KEY + VITE_SHP_API_KEY in Vercel and redeploy to ACTIVATE the gate.

export function requireAppKey(req, res) {
  const expected = process.env.SHP_API_KEY;
  if (!expected) {
    // Not configured yet — allow, but make it visible in function logs so the
    // operator knows the gate is dormant until the env var is set.
    console.warn('[shp] SHP_API_KEY not set — app-key auth is DORMANT (set it in Vercel to activate)');
    return true;
  }
  const provided = req.headers['x-shp-key'] || req.headers['X-SHP-Key'];
  if (provided === expected) return true;
  res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid app key' });
  return false;
}
