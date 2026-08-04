/**
 * Cloudflare Pages Function — Payfast payment initiation.
 * Route: POST /api/pay
 *
 * Keeps your Merchant Key (and optional passphrase) OFF the public page.
 * Reads the amount + details the customer entered, formats the amount,
 * builds the Payfast parameter string in the required order, signs it,
 * and hands back an auto-submitting form that posts to Payfast.
 *
 * SET THESE IN CLOUDFLARE PAGES → Settings → Environment variables:
 *   PAYFAST_MERCHANT_ID   e.g. 10000100
 *   PAYFAST_MERCHANT_KEY  e.g. 46f0cd694581a
 *   PAYFAST_PASSPHRASE    (optional but recommended — must match the passphrase
 *                          set in your Payfast account under Settings → Security.
 *                          Leave unset only if your account has NO passphrase.)
 *   PAYFAST_SANDBOX       "true" while testing, "false" (or unset) when live.
 */

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const merchant_id = env.PAYFAST_MERCHANT_ID;
  const merchant_key = env.PAYFAST_MERCHANT_KEY;
  const passphrase = env.PAYFAST_PASSPHRASE || "";
  const sandbox = String(env.PAYFAST_SANDBOX || "").toLowerCase() === "true";

  if (!merchant_id || !merchant_key) {
    return htmlResponse(messagePage(
      "Payments aren't switched on yet",
      "The site owner still needs to add their Payfast keys. If you're the owner, set PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY in your Cloudflare Pages environment variables and redeploy."
    ), 503);
  }

  const form = await request.formData();
  const rawAmount = String(form.get("amount") || "").replace(/[,\s]/g, "");
  const amount = parseFloat(rawAmount);
  if (!isFinite(amount) || amount < 5) {
    return htmlResponse(messagePage(
      "Please check the amount",
      "Enter the amount from your quote or invoice — it needs to be at least R5.00.",
      origin + "/payments.html"
    ), 400);
  }

  // Fields in Payfast's required signature order. Empty fields are dropped.
  const data = {
    merchant_id,
    merchant_key,
    return_url: origin + "/payment-success.html",
    cancel_url: origin + "/payment-cancelled.html",
    name_first: clean(form.get("name_first"), 100),
    email_address: clean(form.get("email_address"), 100),
    m_payment_id: "OBM-" + Date.now(),
    amount: amount.toFixed(2),
    item_name: clean(form.get("item_name"), 100) || "Website payment",
    item_description: clean(form.get("custom_str1"), 250),
  };

  const order = [
    "merchant_id", "merchant_key", "return_url", "cancel_url",
    "name_first", "email_address", "m_payment_id", "amount",
    "item_name", "item_description",
  ];

  const present = order.filter((k) => data[k] !== undefined && data[k] !== "");
  let paramString = present.map((k) => `${k}=${pfEncode(data[k])}`).join("&");
  if (passphrase) paramString += `&passphrase=${pfEncode(passphrase)}`;

  const signature = md5(paramString);

  const host = sandbox
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";

  const inputs = present
    .map((k) => `<input type="hidden" name="${k}" value="${escapeAttr(data[k])}">`)
    .join("") + `<input type="hidden" name="signature" value="${signature}">`;

  return htmlResponse(autoPost(host, inputs));
}

// If someone opens /api/pay directly, send them to the payment page.
export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  return Response.redirect(origin + "/payments.html", 302);
}

/* ---------- helpers ---------- */

function clean(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

// Match PHP urlencode(): space -> "+", uppercase hex, encode !'()*~ too.
function pfEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function autoPost(action, inputs) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting to Payfast…</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;color:#201e1d">
<p style="font-size:18px">Taking you to Payfast to complete your payment securely…</p>
<form id="pf" action="${action}" method="post">${inputs}
<noscript><button type="submit" style="padding:12px 24px;font-size:16px;background:#ec3013;color:#fff;border:0;border-radius:8px">Continue to Payfast</button></noscript>
</form>
<script>document.getElementById('pf').submit();</script>
</body></html>`;
}

function messagePage(title, body, backUrl) {
  const back = backUrl ? `<p style="margin-top:24px"><a href="${backUrl}" style="color:#ec3013">← Back to the payment page</a></p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:60px 24px;color:#201e1d">
<h1 style="font-size:24px">${title}</h1><p style="font-size:16px;line-height:1.6;color:#555">${body}</p>${back}
</body></html>`;
}

/* Minimal MD5 (public-domain style). Cloudflare's Web Crypto has no MD5,
   and Payfast signatures require it. */
function md5(str) {
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function au(x, y) {
    const l = (x & 0xffff) + (y & 0xffff);
    return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff);
  }
  function cmn(q, a, b, x, s, t) { return au(rl(au(au(a, q), au(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function tb(s) {
    const u = unescape(encodeURIComponent(s));
    const n = [];
    for (let i = 0; i < u.length; i++) n[i >> 2] |= u.charCodeAt(i) << ((i % 4) * 8);
    n[u.length >> 2] |= 0x80 << ((u.length % 4) * 8);
    n[(((u.length + 8) >> 6) + 1) * 16 - 2] = u.length * 8;
    return n;
  }
  function rh(n) { let s = ""; for (let j = 0; j < 4; j++) s += ("0" + ((n >> (j * 8)) & 0xff).toString(16)).slice(-2); return s; }
  const x = tb(str);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i] || 0, 7, -680876936); d = ff(d, a, b, c, x[i + 1] || 0, 12, -389564586);
    c = ff(c, d, a, b, x[i + 2] || 0, 17, 606105819); b = ff(b, c, d, a, x[i + 3] || 0, 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4] || 0, 7, -176418897); d = ff(d, a, b, c, x[i + 5] || 0, 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6] || 0, 17, -1473231341); b = ff(b, c, d, a, x[i + 7] || 0, 22, -45705983);
    a = ff(a, b, c, d, x[i + 8] || 0, 7, 1770035416); d = ff(d, a, b, c, x[i + 9] || 0, 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10] || 0, 17, -42063); b = ff(b, c, d, a, x[i + 11] || 0, 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12] || 0, 7, 1804603682); d = ff(d, a, b, c, x[i + 13] || 0, 12, -40341101);
    c = ff(c, d, a, b, x[i + 14] || 0, 17, -1502002290); b = ff(b, c, d, a, x[i + 15] || 0, 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1] || 0, 5, -165796510); d = gg(d, a, b, c, x[i + 6] || 0, 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11] || 0, 14, 643717713); b = gg(b, c, d, a, x[i] || 0, 20, -373897302);
    a = gg(a, b, c, d, x[i + 5] || 0, 5, -701558691); d = gg(d, a, b, c, x[i + 10] || 0, 9, 38016083);
    c = gg(c, d, a, b, x[i + 15] || 0, 14, -660478335); b = gg(b, c, d, a, x[i + 4] || 0, 20, -405537848);
    a = gg(a, b, c, d, x[i + 9] || 0, 5, 568446438); d = gg(d, a, b, c, x[i + 14] || 0, 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3] || 0, 14, -187363961); b = gg(b, c, d, a, x[i + 8] || 0, 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13] || 0, 5, -1444681467); d = gg(d, a, b, c, x[i + 2] || 0, 9, -51403784);
    c = gg(c, d, a, b, x[i + 7] || 0, 14, 1735328473); b = gg(b, c, d, a, x[i + 12] || 0, 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5] || 0, 4, -378558); d = hh(d, a, b, c, x[i + 8] || 0, 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11] || 0, 16, 1839030562); b = hh(b, c, d, a, x[i + 14] || 0, 23, -35309556);
    a = hh(a, b, c, d, x[i + 1] || 0, 4, -1530992060); d = hh(d, a, b, c, x[i + 4] || 0, 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7] || 0, 16, -155497632); b = hh(b, c, d, a, x[i + 10] || 0, 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13] || 0, 4, 681279174); d = hh(d, a, b, c, x[i] || 0, 11, -358537222);
    c = hh(c, d, a, b, x[i + 3] || 0, 16, -722521979); b = hh(b, c, d, a, x[i + 6] || 0, 23, 76029189);
    a = hh(a, b, c, d, x[i + 9] || 0, 4, -640364487); d = hh(d, a, b, c, x[i + 12] || 0, 11, -421815835);
    c = hh(c, d, a, b, x[i + 15] || 0, 16, 530742520); b = hh(b, c, d, a, x[i + 2] || 0, 23, -995338651);
    a = ii(a, b, c, d, x[i] || 0, 6, -198630844); d = ii(d, a, b, c, x[i + 7] || 0, 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14] || 0, 15, -1416354905); b = ii(b, c, d, a, x[i + 5] || 0, 21, -57434055);
    a = ii(a, b, c, d, x[i + 12] || 0, 6, 1700485571); d = ii(d, a, b, c, x[i + 3] || 0, 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10] || 0, 15, -1051523); b = ii(b, c, d, a, x[i + 1] || 0, 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8] || 0, 6, 1873313359); d = ii(d, a, b, c, x[i + 15] || 0, 10, -30611744);
    c = ii(c, d, a, b, x[i + 6] || 0, 15, -1560198380); b = ii(b, c, d, a, x[i + 13] || 0, 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4] || 0, 6, -145523070); d = ii(d, a, b, c, x[i + 11] || 0, 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2] || 0, 15, 718787259); b = ii(b, c, d, a, x[i + 9] || 0, 21, -343485551);
    a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
  }
  return rh(a) + rh(b) + rh(c) + rh(d);
}
