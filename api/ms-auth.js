// Microsoft Graph OAuth flow for one-click tracked sends.
// Single-tenant: one rep (Anthony) — tokens stored under a fixed KV key.
//
// Routes (action via ?action=):
//   start    → 302 to Microsoft login
//   callback → exchanges code for tokens, persists, redirects back to /
//   status   → { connected, account, connectedAt }
//   logout   → clears tokens
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

const TOKEN_KEY = 'shp:ms:tokens';
const STATE_KEY = 'shp:ms:oauth_state';
const SCOPES = 'Mail.Send User.Read offline_access';

function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!r.ok) return null;
  const json = await r.json();
  if (!json?.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

async function kvSet(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV set ${r.status}`);
}

async function kvDel(key) {
  await fetch(`${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
}

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
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
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

    // ─── CALLBACK: exchange code for tokens ──────────────────────
    if (action === 'callback') {
      const appBase = getAppBase(req);
      const { code, state, error: oauthError, error_description } = req.query || {};

      if (oauthError) {
        return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent(oauthError + (error_description ? ': ' + error_description : ''))}`);
      }
      if (!code) {
        return res.status(400).send('Missing authorization code');
      }

      // Verify state to prevent CSRF
      const savedState = await kvGet(STATE_KEY);
      if (!savedState?.state || savedState.state !== state) {
        return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent('OAuth state mismatch — try connecting again')}`);
      }
      await kvDel(STATE_KEY);

      // Exchange code for access + refresh tokens
      const tokenResp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code.toString(),
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: SCOPES,
        }).toString(),
      });
      const tokens = await tokenResp.json();
      if (!tokenResp.ok || !tokens.access_token) {
        return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent('Token exchange failed: ' + (tokens.error_description || tokens.error || 'unknown'))}`);
      }

      // Fetch account info so the UI can show "connected as anthony@..."
      const meResp = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const me = meResp.ok ? await meResp.json() : null;

      await kvSet(TOKEN_KEY, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in * 1000),
        account: me ? {
          email: me.userPrincipalName || me.mail || null,
          name: me.displayName || null,
          id: me.id || null,
        } : null,
        connectedAt: new Date().toISOString(),
      });

      return res.redirect(302, `${appBase}/?ms_connected=1`);
    }

    // ─── STATUS ──────────────────────────────────────────────────
    if (action === 'status') {
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

    return res.status(400).json({ error: 'Unknown action. Use ?action=start|callback|status|logout' });
  } catch (err) {
    return res.status(500).json({ error: 'ms-auth failed', message: err.message });
  }
}
