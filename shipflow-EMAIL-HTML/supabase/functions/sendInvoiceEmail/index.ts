import {
  createClientFromRequest, json, serve, HttpError, fetchBounded, escapeHtml,
} from '../_shared/base44-compat.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

// Mailgun encodes attachments as base64 (~33% overhead), so limit raw bytes to 37MB → ~49MB encoded
const MAX_BYTES = 37 * 1024 * 1024;

// Kept in sync with src/lib/emailHtml.js — the client-side .eml (Outlook
// draft) path uses the same sender and the same HTML shell, so a message
// looks identical whichever route it goes out by.
const DEFAULT_FROM_EMAIL = 'mhart@capitalnutrition.ca';
const DEFAULT_FROM_NAME = 'Capital Nutrition';

async function compressPdf(bytes) {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const compressed = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return compressed.length < bytes.length ? compressed : bytes;
  } catch {
    return bytes;
  }
}

async function sendEmail({ apiKey, domain, from, replyTo, to, bcc, subject, body, htmlBody, files }) {
  const formData = new FormData();
  formData.append('from', from);
  formData.append('to', to);
  if (bcc) formData.append('bcc', bcc);
  // Mail is sent through mg.<domain> but addressed From the human mailbox, so
  // without an explicit Reply-To a customer's reply goes to the Mailgun
  // subdomain and is never read.
  if (replyTo) formData.append('h:Reply-To', replyTo);
  formData.append('subject', subject);
  formData.append('text', body);
  formData.append('html', htmlBody);
  for (const { bytes, filename } of files) {
    formData.append('attachment', new Blob([bytes], { type: 'application/pdf' }), filename);
  }
  const resp = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(`api:${apiKey}`) },
    body: formData,
  });
  // Mailgun answers auth and domain errors with text/plain, not JSON. Parsing
  // unconditionally turned the most likely first-run failure — a wrong API key —
  // into "Unexpected token 'F', \"Forbidden\" is not valid JSON", which sends
  // whoever reads it looking in entirely the wrong place.
  const raw = await resp.text();
  let result: Record<string, unknown> = {};
  try { result = JSON.parse(raw); } catch { /* non-JSON error body */ }
  if (!resp.ok) {
    const detail = (result.message as string) || raw.slice(0, 200) || resp.statusText;
    throw new Error(`Mailgun rejected the request (${resp.status}): ${detail}`);
  }
  return result.id as string;
}

serve(async (req) => {
  try {
    const base44 = await createClientFromRequest(req);
    const user = await base44.auth.me(); // throws 401 if the JWT is missing/expired

    const { to, subject, body, attachments } = await req.json();
    if (!to || !subject || !body) {
      return json(req, { error: 'Missing required fields: to, subject, body' }, 400);
    }

    // Recipients: validate and bound. Mailgun accepts a comma-separated list,
    // so an unvalidated `to` turns this into a mass-mail relay that is fully
    // SPF/DKIM-signed by the company domain.
    const recipients = String(to)
      .split(',')
      .map((r: string) => r.trim())
      .filter(Boolean);
    if (recipients.length === 0 || recipients.length > 10) {
      throw new HttpError('Provide between 1 and 10 recipients.', 400);
    }
    for (const r of recipients) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) {
        throw new HttpError(`Not a valid email address: ${r}`, 400);
      }
    }

    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const s = settings[0] || {};
    // The API key comes from function env only. It used to fall back to a
    // column in app_settings, which every authenticated user could read.
    const apiKey = Deno.env.get('MAILGUN_API_KEY');
    const domain = Deno.env.get('MAILGUN_DOMAIN') ?? s.mailgun_domain;
    // The sender is configuration, not caller input: accepting from_email
    // from the client let any user send mail as anyone at the company.
    // Falls back to the company mailbox rather than noreply@mg.<domain>:
    // that address does not exist, so bounces and replies were black-holed.
    const finalFromEmail = s.mailgun_from_email || DEFAULT_FROM_EMAIL;
    const finalFromName = s.mailgun_from_name || DEFAULT_FROM_NAME;

    if (!apiKey) {
      throw new HttpError(
        'MAILGUN_API_KEY is not configured on this function. Set it with `supabase secrets set`.',
        503,
      );
    }
    if (!domain) {
      throw new HttpError('Mailgun domain is not configured. Go to Settings > Email.', 400);
    }

    const logoUrl = s.logo_url || '';
    const companyName = s.company_name || finalFromName;
    // `body` and `logo_url` are user-controlled. Interpolated raw, they let a
    // user inject markup — a fake remittance block, or a broken img tag —
    // into mail that customers receive from the company's own domain.
    const paragraphs = String(body)
      .split(/\n{2,}/)
      .map((block: string) => escapeHtml(block).replace(/\n/g, '<br>'))
      .filter((block: string) => block.length > 0)
      .map((block: string) => `<p style="margin:0 0 14px 0;">${block}</p>`)
      .join('');
    const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;max-width:600px;">
${paragraphs}
${logoUrl ? `<div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)}" style="max-height:48px;max-width:180px;object-fit:contain;" /></div>` : ''}
</div>
</body></html>`;
    const from = `${finalFromName} <${finalFromEmail}>`;

    // Fetch all attachments (support both URL-based and base64-based)
    const fetched = [];
    for (const att of (attachments || [])) {
      let bytes;
      if (att.base64) {
        if (typeof att.base64 !== 'string' || att.base64.length > 40 * 1024 * 1024) {
          throw new HttpError(`Attachment ${att.filename} is too large.`, 413);
        }
        // base64-encoded PDF passed directly (used for split invoices)
        let binary: string;
        try {
          binary = atob(att.base64);
        } catch {
          throw new HttpError(`Attachment ${att.filename} is not valid base64.`, 400);
        }
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      } else {
        // Validated + size-capped: an unrestricted server-side fetch here is
        // an SSRF that exfiltrates the response by emailing it.
        ({ bytes } = await fetchBounded(att.url));
      }
      fetched.push({ bytes, filename: att.filename });
    }

    // Compress all PDFs
    for (const f of fetched) {
      const before = f.bytes.length;
      f.bytes = await compressPdf(f.bytes);
      console.log(`${f.filename}: ${(before/1024/1024).toFixed(1)}MB → ${(f.bytes.length/1024/1024).toFixed(1)}MB`);
    }

    // Split into batches that fit within MAX_BYTES
    const batches = [];
    let current = [], currentSize = 0;
    for (const f of fetched) {
      if (currentSize + f.bytes.length > MAX_BYTES && current.length > 0) {
        batches.push(current);
        current = [f];
        currentSize = f.bytes.length;
      } else {
        current.push(f);
        currentSize += f.bytes.length;
      }
    }
    if (current.length > 0) batches.push(current);
    // A request with no attachments produced an empty batch list, so the send
    // loop never ran and the function returned {success:true, emails_sent:0}.
    // The Settings page's "send a test email" button posts exactly that shape,
    // which meant the one check anyone would run to prove email works was
    // guaranteed to report success without sending anything.
    if (batches.length === 0) batches.push([]);

    console.log(`Sending ${batches.length} email(s) for ${fetched.length} attachment(s)`);

    const ids: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      const batchSubject = batches.length > 1 ? `${subject} (${i + 1}/${batches.length})` : subject;
      const batchBody = batches.length > 1
        ? `${body}\n\n[Email ${i + 1} of ${batches.length} — ${batches[i].length} attachment(s)]`
        : body;
      const batchHtml = batches.length > 1
        ? htmlBody + `<p style="color:#6b7280;font-size:12px;margin-top:16px;">Email ${i + 1} of ${batches.length} — ${batches[i].length} attachment(s)</p>`
        : htmlBody;
      try {
        const id = await sendEmail({
          apiKey, domain, from, replyTo: finalFromEmail,
          to: recipients.join(','), bcc: s.mailgun_bcc,
          subject: batchSubject, body: batchBody, htmlBody: batchHtml, files: batches[i],
        });
        ids.push(id);
        console.log(`Sent batch ${i + 1}/${batches.length}: ${id}`);
      } catch (batchError) {
        // Batches before this one are already in the customer's inbox.
        // Reporting a bare failure made the user retry the whole send, so
        // the customer received those invoices twice. Report what landed and
        // where to resume instead.
        console.error(
          `Batch ${i + 1}/${batches.length} failed after ${ids.length} sent:`,
          (batchError as Error).message,
        );
        return json(req, {
          success: false,
          partial: ids.length > 0,
          emails_sent: ids.length,
          ids,
          failed_batch: i + 1,
          total_batches: batches.length,
          resume_from_batch: i + 1,
          error: `Sent ${ids.length} of ${batches.length} emails, then failed on batch ${i + 1}: ${
            (batchError as Error).message
          }`,
        }, 207);
      }
    }

    return json(req, { success: true, emails_sent: ids.length, ids });

  } catch (error) {
    // Let serve() classify it: hardcoding 500 turned an expired JWT into a
    // server error, so the client could never tell "log in again" from
    // "the server is broken".
    throw error;
  }
});