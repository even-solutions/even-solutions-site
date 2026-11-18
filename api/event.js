// Receives browser contact clicks (Text, Call, WhatsApp) and mirrors them to the Meta Conversions API.
// The browser Pixel sends the same event with the same event_id, so Meta counts it once.
const { sendMetaEvent } = require('./_meta');

const ALLOWED = { Contact: true };
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !ALLOWED[body.event_name]) return res.status(400).json({ ok: false });

  const host = String(req.headers.host || '');
  const url = clean(body.url, 500);
  const sameSite = url.startsWith('https://' + host) || /^https:\/\/(www\.)?evensolutionsusa\.com\//.test(url);
  if (!sameSite) return res.status(400).json({ ok: false });

  const method = clean(body.method, 20);
  const capi = await sendMetaEvent({
    eventName: body.event_name,
    eventId: clean(body.event_id, 64),
    url,
    req,
    fbclid: clean(body.fbclid, 300),
    custom: { contact_method: method, lead_code: clean(body.lead_code, 40) },
  });
  return res.status(200).json({ ok: true, capi });
};
