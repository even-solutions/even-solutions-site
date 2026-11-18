/* Even Solutions — tracking + contact links (port of the Beta Painting tracking.js) */
(function () {
  var C = window.EVEN_CONFIG || {};

  // 1) Google tag (only if configured)
  if (C.ga4Id || C.googleAdsId) {
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + (C.ga4Id || C.googleAdsId);
    document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    if (C.ga4Id) gtag('config', C.ga4Id);
    if (C.googleAdsId) gtag('config', C.googleAdsId, { allow_enhanced_conversions: true });
  }

  // 2) Meta Pixel (only if configured)
  if (C.metaPixelId && /^[0-9]+$/.test(C.metaPixelId)) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', C.metaPixelId);
    fbq('track', 'PageView');
  }
})();

(function () {
  var C = window.EVEN_CONFIG || {};
  var WA = C.whatsapp || '', SMS = C.phone, DAYS = 90, DOMAIN = C.cookieDomain || '';
  var KEYS = ['gclid','gbraid','wbraid','fbclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','svc'];
  var p = new URLSearchParams(location.search);
  var onDomain = DOMAIN && location.hostname.slice(-DOMAIN.length + 1) === DOMAIN.slice(1);
  function setC(k, v) { document.cookie = 'ev_' + k + '=' + encodeURIComponent(v) + ';max-age=' + DAYS * 86400 + ';path=/' + (onDomain ? ';domain=' + DOMAIN : '') + ';SameSite=Lax'; }
  function getC(k) { var m = document.cookie.match('(?:^|; )ev_' + k + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }

  // Last visit with parameters (90 days). A new ad click replaces everything.
  var CLICK = ['gclid','gbraid','wbraid','fbclid'];
  if (CLICK.some(function (k) { return p.get(k); })) { KEYS.forEach(function (k) { setC(k, p.get(k) || ''); }); }
  else { KEYS.forEach(function (k) { if (p.get(k)) setC(k, p.get(k)); }); }
  var v = function (k) { return p.get(k) || getC(k); };

  // Code = channel + service
  var src = (v('utm_source') || '').toLowerCase();
  var ch = (src === 'google' || v('gclid') || v('gbraid') || v('wbraid')) ? 'GA' : (src === 'meta' || v('fbclid')) ? 'MA' : 'WEB';
  var svc = (v('svc') || '').toUpperCase(); if (['FLR','PNT','BTH','WAL'].indexOf(svc) < 0) svc = 'GEN';
  var ask = { FLR: "I'd like an estimate for flooring.", PNT: "I'd like an estimate for painting.",
              BTH: "I'd like an estimate for a bathroom remodel.", WAL: "I'd like an estimate for an accent wall.",
              GEN: "I'd like a remodeling estimate." }[svc];
  var code = ch + '-' + svc, msg = 'Code: ' + code + ' - Hi! ' + ask;
  window.EVEN_LEAD_CODE = code;
  var SMS_URL = 'sms:+' + SMS + '?&body=' + encodeURIComponent(msg);
  var WA_URL = WA ? 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg) : SMS_URL;
  var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
  var ADS = C.adsConversions || {};
  var push = function (e) {
    (window.dataLayer = window.dataLayer || []).push({ event: e, lead_code: code });
    if (typeof window.gtag === 'function') window.gtag('event', 'contact_click', { contact_method: e.replace(/_click$/, ''), service: svc });
    if (ADS[e] && typeof window.gtag === 'function') gtag('event', 'conversion', { send_to: ADS[e] });
  };
  var metaContact = function (method) { if (typeof window.fbq === 'function') fbq('track', 'Contact', { contact_method: method, lead_code: code }); };

  var isWA = function (a) { return a.classList.contains('btn-wa'); };
  var isSMS = function (a) { return a.classList.contains('btn-sms'); };
  var isCALL = function (a) { return a.classList.contains('btn-call'); };

  function apply() {
    document.querySelectorAll('a').forEach(function (a) {
      if (isWA(a)) { a.href = WA_URL; if (!WA) { a.removeAttribute('target'); } }
      else if (isSMS(a)) { if (mobile) a.href = SMS_URL; else a.style.display = 'none'; } // Text hidden on desktop
      else if (isCALL(a)) a.href = 'tel:+' + SMS;
    });
    // Form hidden fields (utm_content = code)
    KEYS.forEach(function (k) {
      document.querySelectorAll('input[name="' + k + '"]').forEach(function (i) { i.value = k === 'utm_content' ? code : v(k); });
    });
    if (!v('utm_source')) {
      var fb = { GA: ['google','cpc'], MA: ['meta','paid_social'], WEB: ['website','organic'] }[ch];
      document.querySelectorAll('input[name="utm_source"]').forEach(function (i) { i.value = fb[0]; });
      document.querySelectorAll('input[name="utm_medium"]').forEach(function (i) { i.value = fb[1]; });
    }
    // Pre-select the service once
    var want = { FLR: /floor/i, PNT: /paint/i, BTH: /bath/i, WAL: /accent|wall/i }[svc]; if (!want) return;
    document.querySelectorAll('select:not([data-ev])').forEach(function (sel) {
      sel.setAttribute('data-ev', '1');
      if (sel.value) return;
      for (var j = 0; j < sel.options.length; j++) { if (want.test(sel.options[j].text)) { sel.selectedIndex = j; break; } }
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a'); if (!a) return;
    if (isWA(a)) { a.href = WA_URL; push('whatsapp_click'); metaContact('whatsapp'); }
    else if (isSMS(a)) { a.href = SMS_URL; push('sms_click'); metaContact('sms'); }
    else if (isCALL(a)) { push('call_click'); metaContact('phone'); }
  }, true);

  if (document.readyState !== 'loading') apply(); else document.addEventListener('DOMContentLoaded', apply);
})();
