/*
  EVEN SOLUTIONS — central settings for the estimate pages.
  Change only this file to update phones, WhatsApp and tracking IDs.
*/
window.EVEN_CONFIG = {
  // Text + Call number (digits only, with country code 1)
  phone: '16893336828',
  phoneDisplay: '(689) 333-6828',

  // TODO: WhatsApp number, digits only with country code (e.g. '14075551234').
  // While empty, the WhatsApp button opens a text message to the main phone instead.
  whatsapp: '',

  // TODO: Even Solutions Meta (Facebook) Pixel ID, digits only. Empty = pixel does not load.
  metaPixelId: '',

  // Optional: Google Analytics 4 ID (G-XXXXXXX) and Google Ads ID (AW-XXXXXXXXX). Empty = not loaded.
  ga4Id: '',
  googleAdsId: '',
  // Optional Google Ads conversion labels, e.g. 'AW-123456789/AbCdEf'. Empty = not sent.
  adsConversions: { lead_form: '', whatsapp_click: '', sms_click: '', call_click: '' },

  cookieDomain: '.evensolutionsusa.com',
};
