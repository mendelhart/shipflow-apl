/**
 * Shared plain-text -> HTML rendering for outgoing mail.
 *
 * Every outgoing message is now sent as multipart/alternative: the same body
 * text as before as text/plain, plus this HTML rendering. The plain part is
 * kept deliberately — a message with only an HTML part scores worse with spam
 * filters and reads badly in clients that strip HTML.
 *
 * The body is user-authored (Settings templates, plus whatever the sender
 * types in the dialog), so it is escaped before interpolation. Without that,
 * a `<` in a product description silently swallows the rest of the paragraph,
 * and a template could inject markup into mail customers receive from the
 * company's own domain.
 *
 * Kept in sync with the HTML built inside supabase/functions/sendInvoiceEmail
 * so the Mailgun path and the .eml (Outlook draft) path look identical.
 */

export const DEFAULT_FROM_EMAIL = "mhart@capitalnutrition.ca";
export const DEFAULT_FROM_NAME = "Capital Nutrition";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a plain-text mail body as a simple, mail-client-safe HTML document.
 *
 * Deliberately inline-styled and table-free: Outlook (Word rendering engine)
 * drops <style> blocks, and external stylesheets never load in mail at all.
 */
export function renderEmailHtml({ body, logoUrl = "", companyName = DEFAULT_FROM_NAME } = {}) {
  const paragraphs = String(body ?? "")
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
    .filter((block) => block.length > 0)
    .map((block) => `<p style="margin:0 0 14px 0;">${block}</p>`)
    .join("");

  const footer = logoUrl
    ? `<div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">` +
      `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)}" ` +
      `style="max-height:48px;max-width:180px;object-fit:contain;" /></div>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;max-width:600px;">
${paragraphs || "<p style=\"margin:0;\"></p>"}
${footer}
</div>
</body></html>`;
}
