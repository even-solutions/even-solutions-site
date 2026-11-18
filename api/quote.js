// Even Solutions — quick form endpoint (Vercel serverless function).
// Validates, blocks bots (honeypot), limits 5 tries per IP per hour and emails the lead via Resend.
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY  — Resend API key
//   QUOTE_TO        — inbox(es) that receive the leads, comma-separated
//   QUOTE_FROM      — sender, e.g. "Even Solutions <no-reply@evensolutionsusa.com>" (domain verified in Resend)
//                     For tests, "Even Solutions <onboarding@resend.dev>" works (only delivers to the Resend account owner).

const PHONE_DISPLAY = '(689) 333-6828';
const SERVICES = ['Flooring', 'Interior Painting', 'Exterior Painting', 'Bathroom Remodel', 'Accent Walls', 'Demolition', 'Other'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map();

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, ok, message = '') => res.status(status).json({ ok, message });
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

  const { RESEND_API_KEY, QUOTE_TO, QUOTE_FROM } = process.env;
  if (!RESEND_API_KEY || !QUOTE_TO || !QUOTE_FROM) {
    // Fail clearly instead of showing success for a request nobody received.
    return reply(503, false, 'Our form is being set up. Please call or text us at ' + PHONE_DISPLAY + '.');
  }

  const tracking = {};
  for (const k of ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = clean(body[k], 200);
    if (v) tracking[k] = v;
  }
  const rows = [
    ['Name', name], ['Phone', phone], ['Email', email || '—'], ['ZIP code', zip], ['Service', service],
    ['Lead code', tracking.utm_content || '—'],
    ['SMS consent', 'Yes — quick form, ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    ...Object.entries(tracking).filter(([k]) => k !== 'utm_content'),
  ];
  const td = (style, v) => '<td style="padding:12px 24px;border-bottom:1px solid #eee;' + style + '">' + esc(v) + '</td>';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;background:#ece6dc;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">'
    + '<div style="background:#192d54;padding:20px 24px"><p style="margin:0;color:#f2b134;font-size:12px;letter-spacing:2px;text-transform:uppercase">New quote request</p><h1 style="margin:6px 0 0;color:#fff;font-size:20px">Even Solutions</h1></div>'
    + '<table style="width:100%;border-collapse:collapse">'
    + rows.map(([l, v]) => '<tr>' + td('color:#8a6a3f;font-size:12px;text-transform:uppercase;letter-spacing:1px;width:130px', l) + td('color:#192d54;font-size:14px', v) + '</tr>').join('')
    + '</table></div></div>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: QUOTE_FROM,
        to: QUOTE_TO.split(',').map((s) => s.trim()).filter(Boolean),
        subject: 'New estimate request — ' + name + ' (' + service + ')',
        html,
        ...(email ? { reply_to: email } : {}),
      }),
    });
    if (!r.ok) throw new Error('Resend ' + r.status);
  } catch (err) {
    console.error('quote email failed', err);
    return reply(502, false, 'Something went wrong. Please call us at ' + PHONE_DISPLAY + '.');
  }
  return reply(200, true);
};
