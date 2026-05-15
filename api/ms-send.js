// Send an email via Microsoft Graph as the connected user, with a 1×1
// tracking pixel embedded in the HTML body. Each send gets a unique
// trackingId so /api/pixel can log opens back to the right send.
//
// POST /api/ms-send
// Body: {
//   to:         "address@example.com" OR [{ address, name }],
//   subject:    string,
//   body:       string  (plain text — converted to HTML paragraphs here),
//   prospectId: string  (so we can index opens by prospect),
//   bcc?:       string
// }
// Returns: { ok, trackingId, pixelUrl }
//
// Refreshes the access token via refresh_token when expired (60s buffer).

const TOKEN_KEY = 'shp:ms:tokens';
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

function getAppBase(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

// Get a valid access token, refreshing via refresh_token if expired.
async function getValidAccessToken() {
  const stored = await kvGet(TOKEN_KEY);
  if (!stored?.refreshToken) {
    throw new Error('Not connected to Microsoft 365 — connect in Settings first');
  }
  // If access token has 60+ seconds left, use it as-is
  if (stored.expiresAt && Date.now() + 60_000 < stored.expiresAt) {
    return stored.accessToken;
  }
  // Otherwise refresh
  const tokenResp = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES,
    }).toString(),
  });
  const tokens = await tokenResp.json();
  if (!tokenResp.ok || !tokens.access_token) {
    throw new Error('Token refresh failed — reconnect Microsoft 365 in Settings (' + (tokens.error_description || tokens.error || 'unknown') + ')');
  }
  const updated = {
    ...stored,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || stored.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in * 1000),
  };
  await kvSet(TOKEN_KEY, updated);
  return updated.accessToken;
}

// Plain text → minimal HTML, paragraph per double-newline, <br> for single.
// Also escapes <>& so the recipient sees literal characters, not injected HTML.
function plainTextToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 12px 0">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!kvAvailable()) return res.status(500).json({ error: 'KV not configured' });
  if (!process.env.MS_CLIENT_ID || !process.env.MS_TENANT_ID || !process.env.MS_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Microsoft 365 env vars not set' });
  }

  const { to, subject, body, prospectId, bcc } = req.body || {};
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing to/subject/body' });
  }

  try {
    const accessToken = await getValidAccessToken();

    // Generate a unique tracking ID for this send
    const trackingId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const appBase = getAppBase(req);
    const pixelUrl = `${appBase}/api/pixel?id=${trackingId}`;

    // Build HTML body with tracking pixel appended at the very end
    const htmlBody = plainTextToHtml(body) +
      `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;width:1px;height:1px;opacity:0" />`;

    // Normalize recipients
    const toList = Array.isArray(to)
      ? to.map(r => ({ address: r.address || r.email || r, name: r.name || '' }))
      : [{ address: to, name: '' }];
    const toRecipients = toList.map(r => ({
      emailAddress: { address: r.address, name: r.name || '' },
    }));
    const bccRecipients = bcc ? [{ emailAddress: { address: bcc } }] : undefined;

    // Send via Graph
    const sendResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients,
          ...(bccRecipients ? { bccRecipients } : {}),
        },
        saveToSentItems: true,
      }),
    });

    if (!sendResp.ok) {
      const errText = await sendResp.text();
      let errDetail;
      try { errDetail = JSON.parse(errText); } catch { errDetail = { raw: errText }; }
      return res.status(sendResp.status).json({
        error: 'Graph sendMail failed',
        status: sendResp.status,
        details: errDetail,
      });
    }

    // Persist send metadata so /api/opens can return useful info
    await kvSet(`shp:trackmeta:${trackingId}`, {
      prospectId: prospectId || null,
      subject,
      to: toList,
      sentAt: new Date().toISOString(),
    });

    // Append to per-prospect tracking index
    if (prospectId) {
      const indexKey = `shp:trackindex:${prospectId}`;
      const existing = (await kvGet(indexKey)) || [];
      existing.push(trackingId);
      await kvSet(indexKey, existing);
    }

    return res.status(200).json({ ok: true, trackingId, pixelUrl });
  } catch (err) {
    return res.status(500).json({ error: 'ms-send failed', message: err.message });
  }
}
