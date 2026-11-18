// Even Solutions — quick form endpoint (Vercel serverless function).
// Validates, blocks bots (honeypot), limits 5 tries per IP per hour, creates the lead in Kommo,
// optionally emails a copy (Resend) and sends a Lead event to the Meta Conversions API.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   KOMMO_BASE_URL         — e.g. https://evensolutions.kommo.com   (required)
//   KOMMO_ACCESS_TOKEN     — long-lived token of a Kommo private integration (required)
//   KOMMO_PIPELINE_ID      — pipeline that receives website leads (required)
//   KOMMO_STATUS_ID        — stage to move the lead into (optional; empty = stays in "Incoming leads")
//   KOMMO_SOURCE_NAME      — label shown in Kommo (optional, default "Even Solutions Website")
//   RESEND_API_KEY, QUOTE_TO, QUOTE_FROM — optional email copy of each lead
//   META_PIXEL_ID, META_CAPI_TOKEN       — see api/_meta.js

const { randomUUID } = require('crypto');
const { sendMetaEvent } = require('./_meta');

const PHONE_DISPLAY = '(689) 333-6828';
const SERVICES = ['Flooring', 'Interior Painting', 'Exterior Painting', 'Bathroom Remodel', 'Accent Walls', 'Demolition', 'Other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map();

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

async function kommo(path, token, base, payload) {
  return fetch(base + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, ok, message = '') => res.status(status).json({ ok, message });
  const failMsg = 'We could not receive your request. Please call or text us at ' + PHONE_DISPLAY + '.';
  if (req.method !== 'POST') return reply(405, false, 'Method not allowed.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return reply(400, false, 'Please check the required fields.');

  if (clean(body.company, 50)) return reply(200, true); // honeypot

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return reply(429, false, 'Too many requests. Please call us at ' + PHONE_DISPLAY + '.');

  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 254).toLowerCase();
  const zip = clean(body.zipCode, 5);
  const service = clean(body.service, 40);
  if (!name || !phone || !/^[0-9]{5}$/.test(zip) || !SERVICES.includes(service) || (email && !EMAIL_RE.test(email))) {
    return reply(400, false, 'Please check the required fields.');
  }
  if (body.smsConsent !== true) return reply(400, false, 'Please accept the contact terms to continue.');

  const base = String(process.env.KOMMO_BASE_URL || '').replace(/\/+$/, '');
  const token = String(process.env.KOMMO_ACCESS_TOKEN || '');
  const pipelineId = posInt(process.env.KOMMO_PIPELINE_ID);
  const statusId = posInt(process.env.KOMMO_STATUS_ID);
  let validBase = false;
  try { const u = new URL(base); validBase = u.protocol === 'https:' && /^[a-z0-9-]+\.kommo\.com$/i.test(u.hostname); } catch {}
  if (!validBase || !token || !pipelineId) {
    // Fail clearly instead of showing success for a request nobody received.
    return reply(503, false, 'Our form is being set up. Please call or text us at ' + PHONE_DISPLAY + '.');
  }

  const tracking = {};
  for (const k of ['gclid', 'gbraid', 'wbraid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = clean(body[k], 300);
    if (v) tracking[k] = v;
  }
  const now = new Date();
  const formPage = clean(body.formPage, 500) || clean(req.headers.referer, 500) || 'https://www.evensolutionsusa.com/quote';

  const leadFields = [];
  const nativeCodes = { gclid: 'GCLID', utm_source: 'UTM_SOURCE', utm_medium: 'UTM_MEDIUM', utm_campaign: 'UTM_CAMPAIGN', utm_content: 'UTM_CONTENT', utm_term: 'UTM_TERM' };
  for (const [key, code] of Object.entries(nativeCodes)) if (tracking[key]) leadFields.push({ field_code: code, values: [{ value: tracking[key] }] });

  const incoming = {
    request_id: randomUUID(),
    source_uid: 'even-solutions-website-quote-v1',
    source_name: process.env.KOMMO_SOURCE_NAME || 'Even Solutions Website',
    pipeline_id: pipelineId,
    created_at: Math.floor(now.getTime() / 1000),
    _embedded: {
      leads: [{ name: 'Website estimate — ' + name + ' (' + service + ')', price: 0, custom_fields_values: leadFields.length ? leadFields : undefined }],
      contacts: [{
        name,
        custom_fields_values: [
          { field_code: 'PHONE', values: [{ value: phone, enum_code: 'MOB' }] },
          ...(email ? [{ field_code: 'EMAIL', values: [{ value: email, enum_code: 'WORK' }] }] : []),
        ],
      }],
    },
    metadata: { form_id: 'even-solutions-quick-form', form_name: 'Even Solutions Quick Form', form_page: formPage, form_sent_at: Math.floor(now.getTime() / 1000), ip },
  };

  let leadId, uid;
  try {
    const r = await kommo('/api/v4/leads/unsorted/forms', token, base, [incoming]);
    if (!r.ok) { console.error('[quote] Kommo HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300)); return reply(502, false, failMsg); }
    const j = await r.json().catch(() => ({}));
    const u = j && j._embedded && j._embedded.unsorted && j._embedded.unsorted[0];
    uid = u && typeof u.uid === 'string' ? u.uid : '';
    leadId = posInt(u && u._embedded && u._embedded.leads && u._embedded.leads[0] && u._embedded.leads[0].id);
  } catch (err) {
    console.error('[quote] Kommo request failed', err && err.message);
    return reply(502, false, failMsg);
  }

  const details = [
    'Service: ' + service,
    'ZIP code: ' + zip,
    'SMS/call consent: yes (quick form, ' + now.toISOString() + ')',
    ...Object.entries(tracking).map(([k, v]) => k + ': ' + v),
  ].join('\n');
  if (leadId) {
    try {
      const n = await kommo('/api/v4/leads/notes', token, base, [{ entity_id: leadId, note_type: 'common', params: { text: 'Estimate request details:\n' + details } }]);
      if (!n.ok) console.error('[quote] Kommo note HTTP ' + n.status);
    } catch { console.error('[quote] Kommo note failed'); }
  }
  if (uid && statusId) {
    try {
      const a = await kommo('/api/v4/leads/unsorted/' + encodeURIComponent(uid) + '/accept', token, base, { status_id: statusId });
      if (!a.ok) console.error('[quote] Kommo accept HTTP ' + a.status);
    } catch { console.error('[quote] Kommo accept failed'); }
  }

  // Meta Conversions API — same event_id as the browser Pixel "Lead" on /thank-you (deduplicated by Meta).
  await sendMetaEvent({
    eventName: 'Lead',
    eventId: clean(body.meta_event_id, 64),
    url: formPage,
    req,
    fbclid: tracking.fbclid,
    user: { email, phone, zip, name },
    custom: { content_name: service, lead_code: tracking.utm_content || '' },
  });

  // Optional email copy.
  const { RESEND_API_KEY, QUOTE_TO, QUOTE_FROM } = process.env;
  if (RESEND_API_KEY && QUOTE_TO && QUOTE_FROM) {
    const rows = [['Name', name], ['Phone', phone], ['Email', email || '—'], ['ZIP code', zip], ['Service', service], ['Lead code', tracking.utm_content || '—']];
    const td = (style, v) => '<td style="padding:10px 20px;border-bottom:1px solid #eee;' + style + '">' + esc(v) + '</td>';
    const html = '<div style="font-family:Arial,sans-serif;background:#ece6dc;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden"><div style="background:#192d54;padding:18px 20px;color:#fff;font-size:18px">New estimate request — Even Solutions</div><table style="width:100%;border-collapse:collapse">'
      + rows.map(([l, v]) => '<tr>' + td('color:#8a6a3f;font-size:12px;text-transform:uppercase;width:120px', l) + td('color:#192d54;font-size:14px', v) + '</tr>').join('') + '</table></div></div>';
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: QUOTE_FROM, to: QUOTE_TO.split(',').map((s) => s.trim()).filter(Boolean), subject: 'New estimate request — ' + name + ' (' + service + ')', html, ...(email ? { reply_to: email } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) console.warn('[quote] email copy HTTP ' + r.status);
    } catch { console.warn('[quote] email copy failed'); }
  }

  return reply(200, true);
};
