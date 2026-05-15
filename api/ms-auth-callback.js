// Dedicated OAuth callback endpoint — no query string in the path, so Azure
// portal accepts the redirect URI without manifest editing.
//
// Azure App Registration redirect URI: https://<your-app>/api/ms-auth-callback
//
// Receives ?code=...&state=... from Microsoft after the user grants consent,
// exchanges the code for tokens, persists them to KV, and redirects back to /
// with ?ms_connected=1 (success) or ?ms_error=... (failure).

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
  await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
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

export default async function handler(req, res) {
  const appBase = getAppBase(req);
  const redirectUri = `${appBase}/api/ms-auth-callback`;

  if (!kvAvailable()) {
    return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent('KV not configured')}`);
  }
  if (!process.env.MS_CLIENT_ID || !process.env.MS_TENANT_ID || !process.env.MS_CLIENT_SECRET) {
    return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent('Microsoft 365 env vars not set')}`);
  }

  const { code, state, error: oauthError, error_description } = req.query || {};

  if (oauthError) {
    return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent(oauthError + (error_description ? ': ' + error_description : ''))}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    // Verify state to prevent CSRF
    const savedState = await kvGet(STATE_KEY);
    if (!savedState?.state || savedState.state !== state) {
      return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent('OAuth state mismatch — try connecting again')}`);
    }
    await kvDel(STATE_KEY);

    // Exchange code for tokens
    const tokenResp = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
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
  } catch (err) {
    return res.redirect(302, `${appBase}/?ms_error=${encodeURIComponent('Callback failed: ' + err.message)}`);
  }
}
