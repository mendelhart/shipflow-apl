/**
 * Hand-rolled .eml (RFC 5322 / MIME) builder for the "open in Outlook" path.
 *
 * Structure:
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain   <- same body text as the Mailgun path
 *       text/html    <- renderEmailHtml(body)
 *     application/pdf (attachment) ...
 *
 * The alternative part MUST be closed with its own `--alt--` terminator before
 * the attachments are appended. Nesting attachments inside it makes Outlook
 * show a message with no attachments at all.
 */
import { encodeHeader, encodeAddressHeader, encodeTextBody } from "@/lib/mimeHeaders";
import { renderEmailHtml, DEFAULT_FROM_EMAIL } from "@/lib/emailHtml";

/** Base64 must be wrapped at <=76 chars per line (RFC 2045). */
function wrapBase64(base64) {
  // String.match returns null (not []) when there is no match, so an empty
  // attachment threw "Cannot read properties of null" mid-send rather than
  // producing an empty part.
  return (String(base64 || "").match(/.{1,76}/g) || []).join("\r\n");
}

export function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function buildEmlBlob({ from, to, subject, body, html, files }) {
  const stamp = Date.now().toString(36);
  const mixed = `----shipping-docs-mixed-${stamp}`;
  const alt = `----shipping-docs-alt-${stamp}`;
  const { encoding: textEncoding, body: textPart } = encodeTextBody(body);
  // Sent as multipart/alternative so the message renders as HTML in Outlook /
  // Gmail while still carrying a real plain-text part. HTML-only mail scores
  // worse with spam filters and degrades badly in clients that strip markup.
  const htmlSource = html || renderEmailHtml({ body });
  const { encoding: htmlEncoding, body: htmlPart } = encodeTextBody(htmlSource);

  let eml = "";
  eml += `From: ${encodeAddressHeader(from || DEFAULT_FROM_EMAIL)}\r\n`;
  eml += `To: ${encodeAddressHeader(to)}\r\n`;
  eml += `Subject: ${encodeHeader(subject)}\r\n`;
  // Tells (Windows desktop) Outlook to open this .eml as an editable, unsent
  // draft with a visible Send button — without it, double-clicking a .eml
  // opens read-only, styled like a message you received.
  eml += `X-Unsent: 1\r\n`;
  eml += `MIME-Version: 1.0\r\n`;
  eml += `Content-Type: multipart/mixed; boundary="${mixed}"\r\n`;
  eml += `\r\n`;

  // --- body: text/plain + text/html alternatives -------------------------
  eml += `--${mixed}\r\n`;
  eml += `Content-Type: multipart/alternative; boundary="${alt}"\r\n`;
  eml += `\r\n`;

  eml += `--${alt}\r\n`;
  eml += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  eml += `Content-Transfer-Encoding: ${textEncoding}\r\n`;
  eml += `\r\n`;
  eml += `${textPart}\r\n`;
  eml += `\r\n`;

  eml += `--${alt}\r\n`;
  eml += `Content-Type: text/html; charset="UTF-8"\r\n`;
  eml += `Content-Transfer-Encoding: ${htmlEncoding}\r\n`;
  eml += `\r\n`;
  eml += `${htmlPart}\r\n`;
  eml += `\r\n`;

  // The alternative part must be closed before the attachments are appended,
  // or every attachment ends up nested inside it and Outlook shows none.
  eml += `--${alt}--\r\n`;
  eml += `\r\n`;

  // --- attachments -------------------------------------------------------
  for (const f of files) {
    const base64 = wrapBase64(uint8ToBase64(f.bytes));
    eml += `--${mixed}\r\n`;
    eml += `Content-Type: application/pdf; name="${f.filename}"\r\n`;
    eml += `Content-Transfer-Encoding: base64\r\n`;
    eml += `Content-Disposition: attachment; filename="${f.filename}"\r\n`;
    eml += `\r\n`;
    eml += `${base64}\r\n`;
    eml += `\r\n`;
  }

  eml += `--${mixed}--\r\n`;

  return new Blob([eml], { type: "message/rfc822" });
}

