// Shared helper: Meta Conversions API (server-side events).
// Env (Vercel → Settings → Environment Variables):
//   META_PIXEL_ID      — Even Solutions dataset/pixel ID (same as assets/config.js metaPixelId)
//   META_CAPI_TOKEN    — Conversions API access token (Events Manager → Settings → Generate access token)
//   META_TEST_EVENT_CODE (optional) — only while testing in Events Manager → Test events
const crypto = require('crypto');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const norm = {
  em: (v) => String(v || '').trim().toLowerCase(),
  ph: (v) => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 10) d = '1' + d; // US numbers without country code
    return d;
  },
  zp: (v) => String(v || '').trim().slice(0, 5),
  fn: (v) => String(v || '').trim().split(/\s+/)[0].toLowerCase(),
  ln: (v) => { const p = String(v || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1].toLowerCase() : ''; },
};

function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
}

/**
 * Sends one event to the Conversions API. Never throws; returns true when Meta accepted it.
 * opts: { eventName, eventId, url, req, user: { email, phone, zip, name }, custom: {...}, fbclid }
 */
async function sendMetaEvent(opts) {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token || !/^[0-9]+$/.test(pixel)) return false;
  const { req } = opts;
  const u = opts.user || {};
  const user_data = {
    client_ip_address: clientIp(req),
    client_user_agent: String(req.headers['user-agent'] || '') || undefined,
    country: [sha256('us')],
  };
  const fbp = readCookie(req, '_fbp');
  let fbc = readCookie(req, '_fbc');
  if (!fbc && opts.fbclid) fbc = 'fb.1.' + Date.now() + '.' + opts.fbclid;
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  for (const [key, val] of [['em', u.email], ['ph', u.phone], ['zp', u.zip], ['fn', u.name], ['ln', u.name]]) {
    const n = val ? norm[key](val) : '';
    if (n) user_data[key] = [sha256(n)];
  }
  const payload = {
    data: [{
      event_name: opts.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: opts.eventId || undefined,
      action_source: 'website',
      event_source_url: opts.url || undefined,
      user_data,
      custom_data: opts.custom || undefined,
    }],
  };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const r = await fetch('https://graph.facebook.com/v21.0/' + pixel + '/events?access_token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error('[meta] CAPI HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
    return r.ok;
  } catch (err) {
    console.error('[meta] CAPI request failed', err && err.message);
    return false;
  }
}

module.exports = { sendMetaEvent };
