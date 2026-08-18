/**
 * RFC 2047 / RFC 2045 helpers for the hand-rolled .eml builders.
 *
 * Headers were interpolated raw and the plain-text part declared
 * `Content-Transfer-Encoding: 7bit` over UTF-8 content. Both are wrong the
 * moment a single non-ASCII character appears — and the app's own default APL
 * subject contains an en dash, as does the exporter address
 * ("1020 Boul. Michèle-Bohec"). Mail clients then show mojibake, or reject the
 * message outright.
 */

/** Printable ASCII only. */
const NON_ASCII = /[^\x20-\x7E]/;
/** Same, but tab/CR/LF are legitimate in a body. */
const NON_ASCII_BODY = /[^\x09\x0A\x0D\x20-\x7E]/;

/**
 * Encode a header value as RFC 2047 base64 only when it needs it.
 *
 * CR and LF are stripped first: a newline inside a header value ends the header
 * and starts a new one, so an invoice subject built from an LLM-extracted PO
 * number could otherwise inject a Bcc.
 */
export function encodeHeader(value) {
  const v = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (!NON_ASCII.test(v)) return v;
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(v)));
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Encode an address header, leaving the addr-spec alone and encoding only the
 * display name — `=?UTF-8?B?...?= <a@b.c>` is valid, encoding the whole thing
 * is not.
 */
export function encodeAddressHeader(value) {
  const v = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  const m = v.match(/^(.*?)\s*<([^>]+)>$/);
  if (!m) return v;
  const name = m[1].replace(/^"|"$/g, '');
  return name ? `${encodeHeader(name)} <${m[2]}>` : `<${m[2]}>`;
}

/** Body transfer encoding that is honest about non-ASCII content. */
export function encodeTextBody(text) {
  const t = String(text ?? '');
  if (!NON_ASCII_BODY.test(t)) {
    return { encoding: '7bit', body: t.replace(/\n/g, '\r\n') };
  }
  const bytes = new TextEncoder().encode(t.replace(/\n/g, '\r\n'));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { encoding: 'base64', body: (btoa(bin).match(/.{1,76}/g) || []).join('\r\n') };
}
