// Microsoft Graph OAuth flow for one-click tracked sends.
// Tokens stored under a fixed KV key (single-tenant per Vercel deployment).
//
// Routes (action via ?action=):
//   start    → 302 to Microsoft login
//   status   → { connected, account, connectedAt }
//   logout   → clears tokens
// (The OAuth callback lives in /api/ms-auth-callback as a dedicated endpoint
//  — Azure portal accepts it without query-string manifest editing.)
//
// Env vars required (set in Vercel project settings):
//   MS_CLIENT_ID      — Azure App Registration → Application (client) ID
//   MS_TENANT_ID      — Azure App Registration → Directory (tenant) ID
//   MS_CLIENT_SECRET  — Azure App Registration → Certificates & secrets → Value
//   KV_REST_API_URL / KV_REST_API_TOKEN — Vercel KV (Upstash Redis) for token storage
//
// Optional:
//   APP_URL — public base URL (e.g. https://shp-agent.vercel.app).
//             If unset, derived from request headers.

import crypto from 'crypto';
import { kvAvailable, kvDel, kvGet, kvSet } from './_kv.js';

const TOKEN_KEY = 'shp:ms:tokens';
const STATE_KEY = 'shp:ms:oauth_state';
// Mail.Read added so we can detect NDR (bounce) messages in the user's inbox.
// We ONLY query Graph for messages matching NDR patterns (postmaster sender,
// "Undeliverable" subject prefix). Other inbox content is never read or stored.
const SCOPES = 'Mail.Send Mail.Read User.Read offline_access';

function getAppBase(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function getRedirectUri(req) {
  // Dedicated callback endpoint — no query string, so Azure's portal UI
  // accepts it without manifest editing.
  return `${getAppBase(req)}/api/ms-auth-callback`;
}

export default async function handler(req, res) {
  if (!kvAvailable()) {
    return res.status(500).json({ error: 'KV not configured — Microsoft 365 connection needs persistent token storage' });
  }
  if (!process.env.MS_CLIENT_ID || !process.env.MS_TENANT_ID || !process.env.MS_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Microsoft 365 env vars not set (MS_CLIENT_ID, MS_TENANT_ID, MS_CLIENT_SECRET)' });
  }

  const action = (req.query?.action || '').toString();
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = getRedirectUri(req);

  try {
    // ─── START: redirect to Microsoft login ──────────────────────
    if (action === 'start') {
      // CSRF state: cryptographic random instead of Math.random for proper
      // unguessability. Length stays generous to make brute force pointless.
      const state = crypto.randomUUID().replace(/-/g, '');
      await kvSet(STATE_KEY, { state, at: Date.now() });
      const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` + new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: SCOPES,
        state,
        prompt: 'select_account',
      }).toString();
      return res.redirect(302, url);
    }

    // ─── STATUS ──────────────────────────────────────────────────
    if (action === 'status') {
      // Critical: do NOT cache. The UI polls this on every load to decide
      // whether to start the opens/bounces pollers. A cached "connected:
      // false" response (from before the user reconnected) silently
      // disables every M365-dependent feature with no visible error.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const stored = await kvGet(TOKEN_KEY);
      if (!stored?.refreshToken) {
        return res.status(200).json({ connected: false });
      }
      return res.status(200).json({
        connected: true,
        account: stored.account || null,
        connectedAt: stored.connectedAt || null,
      });
    }

    // ─── LOGOUT ──────────────────────────────────────────────────
    if (action === 'logout') {
      await kvDel(TOKEN_KEY);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=start|status|logout' });
  } catch (err) {
    return res.status(500).json({ error: 'ms-auth failed', message: err.message });
  }
}
