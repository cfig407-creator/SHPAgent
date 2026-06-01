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

import crypto from 'crypto';
import { kvAvailable, kvDel, kvGet, kvHGet, kvHGetAll, kvHSet, kvLRange, kvRPushRaw, kvSafeAppendList, kvSet } from './_kv.js';

const TOKEN_KEY = 'shp:ms:tokens';
const SCOPES = 'Mail.Send Mail.Read User.Read offline_access';

// Atomic Redis ops to avoid read-modify-write races on shared state.
// Used by trackindex (per-prospect send list) and bounce records (cross-
// tab polling could otherwise clobber each other's writes).

// Append a value to a Redis list, with one-time migration support: if the
// key holds a legacy JSON-array string (from before the atomic-write fix),
// parse + DEL it, RPUSH all existing items, then RPUSH the new value.
// Subsequent writes are pure RPUSH with no overhead.

// HSET on a Redis hash — atomic per-field write, no race when multiple
// concurrent writers update different fields of the same hash.

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
  // Otherwise refresh. NOTE: do NOT pass `scope` here — it defaults to the
  // scopes originally consented at connect time. Asking for new scopes
  // during refresh fails with invalid_scope when the user hasn't re-
  // authorized. (This was the immediate cause of send failures after the
  // Mail.Read scope was added.) Refresh works on whatever was consented;
  // Mail.Read-only operations (bounce check) get their own scope error
  // separately and prompt the user to reconnect.
  const tokenResp = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const tokens = await tokenResp.json();
  if (!tokenResp.ok || !tokens.access_token) {
    // Refresh failed. Microsoft rotates refresh tokens and invalidates the old
    // one, so a concurrent caller (two tabs, a retry) may have ALREADY refreshed
    // and persisted a fresh token — our refresh_token is just the now-consumed
    // one. Before surfacing a "reconnect" error, re-read KV once: if another
    // caller wrote a still-valid access token, use it instead of failing.
    const fresh = await kvGet(TOKEN_KEY);
    if (fresh?.accessToken && fresh.expiresAt && Date.now() + 60_000 < fresh.expiresAt) {
      return fresh.accessToken;
    }
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
    // crypto.randomUUID() gives 128 bits of entropy → collision-free even
    // under heavy concurrent volume. Shape stays t_<ts>_<rand> so the
    // pixel handler's regex validation continues to pass.
    const trackingId = `t_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
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

    // The email is now SENT. Post-send tracking persistence is best-effort and
    // MUST NOT convert a successful send into a 500 — if it did, the client's
    // retry would send the email a SECOND time. So we wrap the KV writes in
    // their own try/catch and always return 200 once Graph accepted the send.
    let trackingPersisted = true;
    try {
      // Persist send metadata so /api/opens can return useful info
      await kvSet(`shp:trackmeta:${trackingId}`, {
        prospectId: prospectId || null,
        subject,
        to: toList,
        sentAt: new Date().toISOString(),
      });
      // Append to per-prospect tracking index via atomic RPUSH.
      // Prevents lost trackingIds when two sends to the same prospect race.
      if (prospectId) {
        await kvSafeAppendList(`shp:trackindex:${prospectId}`, trackingId);
      }
    } catch (persistErr) {
      trackingPersisted = false;
      console.warn('[shp] ms-send: email sent but tracking persist failed:', persistErr.message);
    }

    return res.status(200).json({ ok: true, trackingId, pixelUrl, trackingPersisted });
  } catch (err) {
    // Surface the actual error message as the top-level `error` field so
    // the frontend (api-client.js reads body.error first) shows the real
    // cause in toasts, not a generic "ms-send failed".
    return res.status(500).json({
      error: err.message || 'ms-send failed',
      message: err.message,
    });
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
  // Polling endpoint — must never be cached. See opens.js for the full
  // explanation; short version: Vercel auto-ETags JSON responses and the
  // browser then 304s every subsequent poll, silently serving stale data.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (!kvAvailable()) return res.status(500).json({ error: 'KV not configured' });
  if (!process.env.MS_CLIENT_ID || !process.env.MS_TENANT_ID || !process.env.MS_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Microsoft 365 env vars not set' });
  }
  // Optional shared-secret check. When BOUNCE_CHECK_SECRET is set, require
  // the matching X-Shp-Secret header. Without this, anyone hitting this URL
  // could trigger a Graph API call against the connected mailbox (which
  // costs nothing per call but does count against Graph quota).
  if (process.env.BOUNCE_CHECK_SECRET && req.headers['x-shp-secret'] !== process.env.BOUNCE_CHECK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    // Load existing bounce records to dedupe (by Graph message id).
    // Try list format first (atomic RPUSH writes); fall back to legacy
    // JSON-string-array format for any data from before the migration.
    let existingBounces = await kvLRange('shp:bounces:all');
    if (existingBounces.length === 0) {
      const legacy = await kvGet('shp:bounces:all');
      if (Array.isArray(legacy)) existingBounces = legacy;
    }
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

    // Persist new bounce records atomically.
    // - shp:bounces:all is a Redis list (RPUSH each new record + LTRIM to 500).
    //   Multi-tab polling won't clobber concurrent writes the way kvSet did.
    // - shp:bounces:byrecipient is a Redis hash (HSET per recipient field).
    //   Two tabs updating different recipients can't lose each other's data.
    if (newRecords.length > 0) {
      for (const rec of newRecords) {
        await kvSafeAppendList('shp:bounces:all', rec);
      }
      // Trim the all-bounces list to last 500
      await fetch(`${process.env.KV_REST_API_URL}/ltrim/${encodeURIComponent('shp:bounces:all')}/-500/-1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      });

      // Update recipient hash. For each new bounce, HGET the field, increment
      // count + update last fields, HSET. Per-field atomic write — even if
      // two recipients race, they target different fields.
      for (const r of newRecords) {
        if (!r.recipient) continue;
        const field = r.recipient;
        const existing = await kvHGet('shp:bounces:byrecipient', field);
        const updated = {
          count: (existing?.count || 0) + 1,
          lastBouncedAt: r.bouncedAt,
          lastReason: r.reason,
        };
        await kvHSet('shp:bounces:byrecipient', field, updated);
      }
    }

    // Read merged set back for the response
    let allBounces = await kvLRange('shp:bounces:all');
    if (allBounces.length === 0) {
      const legacy = await kvGet('shp:bounces:all');
      if (Array.isArray(legacy)) allBounces = legacy;
    }
    let byRecipient = await kvHGetAll('shp:bounces:byrecipient');
    if (Object.keys(byRecipient).length === 0) {
      // Legacy fallback — old JSON-object format
      const legacy = await kvGet('shp:bounces:byrecipient');
      if (legacy && typeof legacy === 'object') byRecipient = legacy;
    }

    return res.status(200).json({
      ok: true,
      scanned: ndrs.length,
      newBounces: newRecords.length,
      totalBounces: allBounces.length,
      byRecipient,
      recent: allBounces.slice(-20).reverse(),
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'check-bounces failed',
      message: err.message,
    });
  }
}
