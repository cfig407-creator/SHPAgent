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
const SCOPES = 'Mail.Send Mail.Read User.Read offline_access';

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
  // Route on ?action= so we stay under the Vercel Hobby 12-function cap.
  // Default behavior (no action) = send email. ?action=check-bounces = scan
  // inbox for NDR messages and persist bounce records.
  const action = (req.query?.action || '').toString();
  if (action === 'check-bounces') return checkBounces(req, res);

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
    // Pixel base URL: prefer PIXEL_BASE_URL env var (e.g. https://track.superiorhardwareproducts.com)
    // so the pixel loads from the SAME ROOT DOMAIN as the sender, dramatically
    // improving deliverability vs. loading from shp-agent.vercel.app.
    // Cross-domain pixel sources are a classic spam-filter trigger (Barracuda
    // rejected an LMP send for exactly this reason). Falls back to the app's
    // base URL when PIXEL_BASE_URL is not set.
    const pixelBase = (process.env.PIXEL_BASE_URL || getAppBase(req)).replace(/\/$/, '');
    const pixelUrl = `${pixelBase}/api/pixel?id=${trackingId}`;

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

// ───────────────────────────────────────────────────────────────────────
// === BOUNCE DETECTION ===
// Scans the connected M365 mailbox for NDR (non-delivery report) messages,
// matches them back to our tracked sends, and persists bounce records.
//
// Microsoft Graph API permission required: Mail.Read (granted via the
// updated OAuth scope; user must reconnect M365 once after this deploy
// to authorize the new permission).
//
// What we DO read:
//   - Messages where sender contains 'postmaster' OR 'mailer-daemon'
//   - OR subject starts with 'Undeliverable' / 'Returned mail' /
//     'Delivery Status Notification' / 'Failure notice'
// What we DO NOT read: any other messages in the mailbox.
//
// GET /api/ms-send?action=check-bounces
// Returns: { ok, scanned, newBounces, totalBounces, byRecipient: {...} }
// ───────────────────────────────────────────────────────────────────────
async function checkBounces(req, res) {
  if (!kvAvailable()) return res.status(500).json({ error: 'KV not configured' });
  if (!process.env.MS_CLIENT_ID || !process.env.MS_TENANT_ID || !process.env.MS_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Microsoft 365 env vars not set' });
  }

  try {
    const accessToken = await getValidAccessToken();

    // Search inbox for NDR messages received in the last 30 days. We use
    // $search (KQL syntax) which supports keyword OR queries on subject.
    // The trailing $top=50 is a hard cap; even very active mailboxes rarely
    // accumulate that many NDRs in 30 days.
    const searchQuery = encodeURIComponent(
      'subject:"Undeliverable" OR subject:"Delivery Status Notification" OR subject:"Returned mail" OR subject:"Failure notice"'
    );
    const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${searchQuery}&$top=50&$select=id,subject,from,receivedDateTime,bodyPreview,body`;

    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ConsistencyLevel: 'eventual', // required for $search
      },
    });

    if (!r.ok) {
      const errText = await r.text();
      // 403 typically means Mail.Read scope wasn't granted yet
      if (r.status === 403) {
        return res.status(403).json({
          error: 'mail_read_scope_required',
          message: 'M365 connection needs to be re-authorized to grant Mail.Read permission. Disconnect and reconnect in Settings.',
        });
      }
      return res.status(r.status).json({ error: 'Graph search failed', status: r.status, raw: errText.slice(0, 500) });
    }

    const data = await r.json();
    const messages = Array.isArray(data?.value) ? data.value : [];

    // Filter: only true NDR senders (postmaster, mailer-daemon, MAILER-DAEMON)
    // OR messages whose subject clearly indicates undelivery (covers cases
    // where the NDR comes from a non-standard sender like the recipient's
    // own domain's spam filter).
    const ndrs = messages.filter(m => {
      const fromAddr = (m.from?.emailAddress?.address || '').toLowerCase();
      const subj = (m.subject || '').toLowerCase();
      const isPostmaster = /postmaster|mailer-daemon|mailerdaemon/i.test(fromAddr);
      const isNdrSubject = /^undeliverable|^returned mail|^failure notice|delivery status notification/i.test(subj);
      return isPostmaster || isNdrSubject;
    });

    // Load existing bounce records to dedupe (by Graph message id)
    const existingBounces = (await kvGet('shp:bounces:all')) || [];
    const existingIds = new Set(existingBounces.map(b => b.graphMessageId));

    // Parse each NDR body to extract recipient + original subject + reason
    const newRecords = [];
    for (const m of ndrs) {
      if (existingIds.has(m.id)) continue;
      const bodyText = m.body?.content || m.bodyPreview || '';
      // Strip HTML tags from body before regex for cleaner extraction
      const plain = bodyText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

      // Heuristic extraction — works for M365, Google, Barracuda, Proofpoint NDR formats
      const recipMatch = plain.match(/Recipient(?:\s+Address)?:\s*([^\s,;<]+@[^\s,;>]+)/i)
        || plain.match(/(?:your message to|message to|message couldn['']t be delivered to)\s*([^\s,;<]+@[^\s,;>]+)/i)
        || plain.match(/<([^@\s>]+@[^@\s>]+)>/);
      const recipient = recipMatch ? recipMatch[1].toLowerCase().replace(/[<>]/g, '') : null;

      const subjMatch = plain.match(/Original Subject:\s*([^\n\r]+)/i)
        || plain.match(/Subject:\s*([^\n\r]+)/i);
      const originalSubject = subjMatch ? subjMatch[1].trim() : null;

      const reasonMatch = plain.match(/5\.\d\.\d+[^\n\r]{0,200}/)
        || plain.match(/550[^\n\r]{0,200}/)
        || plain.match(/554[^\n\r]{0,200}/);
      const reason = reasonMatch ? reasonMatch[0].trim().slice(0, 300) : 'Delivery failed';

      // Try to match back to a trackmeta record by recipient + subject
      let trackingId = null;
      let prospectId = null;
      if (recipient) {
        // Scan recent trackmeta records — KV doesn't have a recipient index so
        // we use the per-prospect trackindex via a recipient→trackingId map.
        // For now we just store the bounce without strict matching; the
        // frontend matches by recipient email against prospect.email.
      }

      const record = {
        graphMessageId: m.id,
        bouncedAt: m.receivedDateTime,
        from: m.from?.emailAddress?.address || '',
        ndrSubject: m.subject,
        recipient,
        originalSubject,
        reason,
        trackingId,
        prospectId,
      };
      newRecords.push(record);
    }

    // Persist updated bounce list
    if (newRecords.length > 0) {
      const merged = [...existingBounces, ...newRecords];
      // Cap at 500 records to keep KV value small
      if (merged.length > 500) merged.splice(0, merged.length - 500);
      await kvSet('shp:bounces:all', merged);

      // Also build a recipient → bounce index for fast lookup from the UI
      const byRecipient = (await kvGet('shp:bounces:byrecipient')) || {};
      for (const r of newRecords) {
        if (!r.recipient) continue;
        const existing = byRecipient[r.recipient] || { count: 0, lastBouncedAt: null, lastReason: '' };
        existing.count = (existing.count || 0) + 1;
        existing.lastBouncedAt = r.bouncedAt;
        existing.lastReason = r.reason;
        byRecipient[r.recipient] = existing;
      }
      await kvSet('shp:bounces:byrecipient', byRecipient);
    }

    const allBounces = newRecords.length > 0 ? [...existingBounces, ...newRecords] : existingBounces;
    const byRecipient = (await kvGet('shp:bounces:byrecipient')) || {};

    return res.status(200).json({
      ok: true,
      scanned: ndrs.length,
      newBounces: newRecords.length,
      totalBounces: allBounces.length,
      byRecipient,
      recent: allBounces.slice(-20).reverse(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'check-bounces failed', message: err.message });
  }
}
