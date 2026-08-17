import { createClientFromRequest, json, serve, HttpError } from '../_shared/base44-compat.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

// Mailgun encodes attachments as base64 (~33% overhead), so limit raw bytes to 37MB → ~49MB encoded
const MAX_BYTES = 37 * 1024 * 1024;

async function compressPdf(bytes) {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const compressed = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return compressed.length < bytes.length ? compressed : bytes;
  } catch {
    return bytes;
  }
}

async function sendEmail({ apiKey, domain, from, to, bcc, subject, body, htmlBody, files }) {
  const formData = new FormData();
  formData.append('from', from);
  formData.append('to', to);
  if (bcc) formData.append('bcc', bcc);
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
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.message || 'Mailgun rejected the request');
  return result.id;
}

serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return json(req, { error: 'Unauthorized' }, 401);

    const { to, subject, body, from_email, from_name, attachments } = await req.json();
    if (!to || !subject || !body) {
      return json(req, { error: 'Missing required fields: to, subject, body' }, 400);
    }

    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const s = settings[0] || {};
    const apiKey = Deno.env.get('MAILGUN_API_KEY') ?? s.mailgun_api_key;
    const domain = Deno.env.get('MAILGUN_DOMAIN') ?? s.mailgun_domain;
    const finalFromEmail = from_email || s.mailgun_from_email || `noreply@${domain}`;
    const finalFromName = from_name || s.mailgun_from_name || 'Shipping Hub';

    if (!apiKey || !domain) {
      return json(req, { error: 'Mailgun not configured. Go to Settings > Email.' }, 400);
    }

    const logoUrl = s.logo_url || '';
    const companyName = s.company_name || finalFromName;
    const bodyHtml = body.replace(/\n/g, '<br>');
    const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;">
  <div style="line-height:1.6;">${bodyHtml}</div>
  ${logoUrl ? `<div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;"><img src="${logoUrl}" alt="${companyName}" style="max-height:48px;max-width:180px;object-fit:contain;" /></div>` : ''}
</div>`;
    const from = `${finalFromName} <${finalFromEmail}>`;

    // Fetch all attachments (support both URL-based and base64-based)
    const fetched = [];
    for (const att of (attachments || [])) {
      let bytes;
      if (att.base64) {
        // base64-encoded PDF passed directly (used for split invoices)
        const binary = atob(att.base64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } else {
        const fileResp = await fetch(att.url);
        if (!fileResp.ok) throw new Error(`Failed to fetch: ${att.filename}`);
        bytes = new Uint8Array(await fileResp.arrayBuffer());
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

    console.log(`Sending ${batches.length} email(s) for ${fetched.length} attachment(s)`);

    const ids = [];
    for (let i = 0; i < batches.length; i++) {
      const batchSubject = batches.length > 1 ? `${subject} (${i + 1}/${batches.length})` : subject;
      const batchBody = batches.length > 1
        ? `${body}\n\n[Email ${i + 1} of ${batches.length} — ${batches[i].length} attachment(s)]`
        : body;
      const batchHtml = batches.length > 1
        ? htmlBody + `<p style="color:#6b7280;font-size:12px;margin-top:16px;">Email ${i + 1} of ${batches.length} — ${batches[i].length} attachment(s)</p>`
        : htmlBody;
      const id = await sendEmail({ apiKey, domain, from, to, bcc: s.mailgun_bcc, subject: batchSubject, body: batchBody, htmlBody: batchHtml, files: batches[i] });
      ids.push(id);
      console.log(`Sent batch ${i + 1}/${batches.length}: ${id}`);
    }

    return json(req, { success: true, emails_sent: ids.length, ids });

  } catch (error) {
    console.error('Error:', error.message);
    return json(req, { error: error.message }, 500);
  }
});