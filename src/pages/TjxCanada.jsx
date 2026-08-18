import React, { useState, useCallback, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeLLM, uploadFile } from '@/lib/aiClient';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FileUp, FileText, Download, Loader2, X, CheckCircle, AlertCircle, Mail, ArrowLeft, Send, Scissors, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { friendlyErrorMessage } from "@/lib/errors";
import { encodeHeader, encodeAddressHeader, encodeTextBody } from "@/lib/mimeHeaders";

// ============================================================================
// Inlined former backend logic — runs client-side because backend functions
// require a Builder plan or higher, which this workspace doesn't have.
// Only InvokeLLM / UploadFile (Core integrations) are used, which are
// available on every Base44 plan. See notes near each section.
// ============================================================================

// ---- PO extraction (was: base44/functions/processInvoicePdf) --------------

function extractLocalText(pdfBytes) {
  const raw = new TextDecoder('latin1').decode(pdfBytes);
  const texts = [];
  const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btBlocks) {
    const tjMatches = block.match(/\(([^)]*)\)\s*(?:Tj|'|")/g) || [];
    for (const m of tjMatches) {
      const t = m.match(/\(([^)]*)\)/);
      if (t && t[1].trim()) texts.push(t[1].trim());
    }
    const tjArrays = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
    for (const tj of tjArrays) {
      const parts = tj.match(/\(([^)]*)\)/g) || [];
      for (const p of parts) {
        const s = p.slice(1, -1).trim();
        if (s) texts.push(s);
      }
    }
  }
  if (texts.length === 0) {
    const fallback = raw.match(/\(([^)]{1,200})\)\s*(?:Tj|'|")/g) || [];
    for (const m of fallback) {
      const t = m.match(/\(([^)]*)\)/);
      if (t && t[1].trim()) texts.push(t[1].trim());
    }
  }
  return { text: texts.join(' '), raw };
}

function cleanPO(val) {
  const po = (val || '').trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9\-]/g, '').toUpperCase();
  return po.length >= 3 ? po : null;
}

function tryRegex(text) {
  const normalizedText = text.replace(/(\d)\s+(\d)/g, '$1$2').replace(/(\d)\s+(\d)/g, '$1$2');
  const purchaseOrderPatterns = [
    /Purchase\s+Order\s+Number\s*[:\s]+(?:PO\s+Number\s*[:\s]+)?([0-9]{6,12})/i,
    /Purchase\s+Order\s*(?:No\.?|#)\s*[:\s]*([0-9]{6,12})/i,
    /P\.?\s*O\.?\s*Number\s*[:\s]*([0-9]{6,12})/i,
    /\bPO\s*#\s*([0-9]{6,12})\b/i,
    /\bPO\s+([0-9]{6,12})\b/i,
  ];
  for (const pattern of purchaseOrderPatterns) {
    const m = normalizedText.match(pattern);
    if (m) {
      const po = cleanPO(m[1]);
      if (po) return po;
    }
  }
  return null;
}

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.message?.includes('Rate limit') || err?.status === 429 || String(err).includes('429');
      if (isRateLimit && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

function fileToUint8Array(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function extractPoNumber(file, onStatus) {
  const pdfBytes = await fileToUint8Array(file);

  if (String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3]) !== '%PDF') {
    throw new Error('Not a valid PDF file');
  }

  const { text: localText, raw } = extractLocalText(pdfBytes);

  if (localText.length >= 10) {
    const po = tryRegex(localText);
    if (po) return po;
  }

  const textToSend = localText.length >= 30 ? localText : raw.replace(/[^\x20-\x7E\n]/g, ' ');
  const snippet = textToSend.slice(0, 6000);

  let poNumber = null;
  try {
    const result = await withRetry(() =>
      invokeLLM({
        prompt: `Extract the TJX Canada Purchase Order number from this invoice text.\n\nSTRICT RULES:\n- Look specifically for a field labeled "Purchase Order Number:", "PO Number:", "P.O. #", "PO#", or "PO No" — this is usually in the Payment Method section\n- Do NOT return a number labeled "Order #", "Order Number", "Order No", "Invoice #", or "Invoice Number" — those are DIFFERENT fields and must be ignored\n- The number may have spaces in it (e.g. "25 118504" or "20 572020") — remove the spaces and return only digits\n- The PO number is typically 7-9 digits when spaces are removed (e.g. 25118504, 20572020)\n- Return ONLY the digits with no spaces or other characters. If you cannot find a field explicitly labeled as PO or Purchase Order Number, return empty string.\n\nText:\n${snippet}`,
        response_json_schema: { type: 'object', properties: { po_number: { type: 'string' } } },
        onStatus,
      })
    );
    poNumber = cleanPO(result?.po_number);
  } catch (err) {
    console.log(`LLM failed: ${err.message}`);
  }

  if (!poNumber) {
    throw new Error('Could not find a Purchase Order number in this document.');
  }

  return poNumber;
}

// ---- PDF splitting (was: base44/functions/splitInvoicePdf) -----------------

function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const SPLIT_LLM_PROMPT = `Analyze this PDF document visually and identify which pages belong to each invoice, and extract the PO number for each.

STRICT RULES for finding PO number:
- Look ONLY for fields explicitly labeled "Purchase Order Number:", "PO Number:", "P.O. #", "PO#", or "PO No"
- Do NOT use "Order #", "Order Number", "Order No", "Invoice #", or "Invoice Number" — those are different fields
- The PO number may have spaces (e.g. "25 118504") — remove spaces and return only the digits/letters
- Return one entry per distinct invoice. If there is only 1 invoice, return 1 entry.
- page_start and page_end are 1-based page numbers (page_end is inclusive)`;

async function splitCombinedPdf(fileUrl, onStatus, filename) {
  const pdfResp = await fetch(fileUrl);
  if (!pdfResp.ok) throw new Error(`Failed to fetch PDF: ${pdfResp.status}`);
  const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());

  if (String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3]) !== '%PDF') {
    throw new Error('Not a valid PDF file');
  }

  const [srcDoc, llmResult] = await Promise.all([
    PDFDocument.load(pdfBytes, { ignoreEncryption: true }),
    invokeLLM({
      prompt: SPLIT_LLM_PROMPT,
      file_urls: [fileUrl],
      filename,
      onStatus,
      response_json_schema: {
        type: 'object',
        properties: {
          invoices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                po_number: { type: 'string' },
                page_start: { type: 'number' },
                page_end: { type: 'number' },
              },
              required: ['po_number', 'page_start', 'page_end'],
            },
          },
        },
      },
    }),
  ]);

  const pageCount = srcDoc.getPageCount();
  if (pageCount === 0) throw new Error('PDF has no pages');

  const rawInvoices = llmResult?.invoices || [];
  if (rawInvoices.length === 0) {
    throw new Error('Could not identify invoices in this PDF.');
  }

  // The model's page ranges were trusted as-is. An inverted range produced a
  // valid, 582-byte, ZERO-PAGE PDF with no error, which was then attached and
  // emailed to the customer as their invoice; an overlapping range put one PO's
  // page inside another PO's invoice. Neither is something a person can catch
  // without opening every attachment, so validate before building anything.
  const rangeProblems = [];
  const seenPages = new Map();
  rawInvoices.forEach((inv, idx) => {
    const label = cleanPO(inv.po_number) || `entry ${idx + 1}`;
    const rawStart = Math.round(inv.page_start);
    const rawEnd = Math.round(inv.page_end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      rangeProblems.push(`${label}: no page range`);
      return;
    }
    if (rawEnd < rawStart) {
      rangeProblems.push(`${label}: pages ${rawStart}-${rawEnd} run backwards`);
      return;
    }
    if (rawStart < 1 || rawEnd > pageCount) {
      rangeProblems.push(`${label}: pages ${rawStart}-${rawEnd} fall outside this ${pageCount}-page PDF`);
      return;
    }
    for (let pg = rawStart; pg <= rawEnd; pg += 1) {
      if (seenPages.has(pg)) rangeProblems.push(`page ${pg} claimed by both ${seenPages.get(pg)} and ${label}`);
      else seenPages.set(pg, label);
    }
  });
  const uncovered = [];
  for (let pg = 1; pg <= pageCount; pg += 1) if (!seenPages.has(pg)) uncovered.push(pg);
  if (uncovered.length) rangeProblems.push(`page(s) ${uncovered.join(', ')} not assigned to any invoice`);

  if (rangeProblems.length) {
    throw new Error(
      `The AI split of this PDF is not usable, so nothing was generated: ${rangeProblems.join('; ')}. ` +
      `Split this file manually and upload the invoices separately.`
    );
  }

  const splitResults = await Promise.all(
    rawInvoices.map(async (inv) => {
      const po = cleanPO(inv.po_number);
      if (!po) return null;

      const start = Math.max(1, Math.round(inv.page_start)) - 1;
      const end = Math.min(pageCount, Math.round(inv.page_end)) - 1;

      const splitDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let i = start; i <= end; i++) pageIndices.push(i);
      const copiedPages = await splitDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach((p) => splitDoc.addPage(p));

      const splitBytes = await splitDoc.save();
      const base64Pdf = uint8ToBase64(splitBytes);

      return { po_number: po, base64_pdf: base64Pdf, pages: pageIndices.length };
    })
  );

  const results = splitResults.filter(Boolean);
  if (results.length === 0) {
    throw new Error('Could not extract PO numbers from invoices in this PDF.');
  }

  return results;
}

// ---- Email fallback (used only if sendInvoiceEmail backend fn is blocked) --
// We never send the Mailgun API key to the browser (that would be a real
// security exposure). Instead: zip the PDFs for download and open a
// pre-filled mail draft in the user's own client to attach manually.

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- invoice archive (searchable history) ----------------------------------
// After a successful send (either path), saves one TjxCanadaInvoiceLog
// record per invoice so it's browsable/searchable later. Reuses the file's
// existing hosted URL when there is one (already-uploaded individual
// invoices); only uploads for split-invoice files that were never given a
// permanent URL. This is deliberately soft-fail — a problem archiving
// shouldn't undo the fact the email already sent successfully.
async function archiveInvoiceRecords({ files, to, subject, sendMethod }) {
  const sentAt = new Date().toISOString();
  await Promise.all(files.map(async (f) => {
    let pdfUrl = f.fileUrl || '';
    if (!pdfUrl) {
      let bytes = f.bytes;
      if (!bytes && f.base64Pdf) bytes = base64ToUint8Array(f.base64Pdf);
      if (bytes) {
        try {
          const uploadResp = await uploadFile({
            file: new File([bytes], f.filename, { type: 'application/pdf' }),
          });
          pdfUrl = uploadResp.file_url || '';
        } catch (err) {
          console.error('Archive: failed to upload PDF for', f.filename, err);
        }
      }
    }
    try {
      // Don't store data URLs (from the local AI client) in the DB — they're
      // too large for an entity field. The hosted URL is kept when present.
      const safePdfUrl = pdfUrl && pdfUrl.startsWith('data:') ? '' : pdfUrl;
      await base44.entities.TjxCanadaInvoiceLog.create({
        po_number: f.poNumber || '',
        filename: f.filename,
        pdf_url: safePdfUrl,
        sent_to: to,
        subject,
        send_method: sendMethod,
        sent_at: sentAt,
      });
    } catch (err) {
      console.error('Archive: failed to save log record for', f.filename, err);
    }
  }));
}

// Gmail/Outlook cap attachments around 25MB. We batch under that so each
// zip fits in one email — leaving a little headroom for the zip container
// itself, since zipping already-compressed PDFs saves almost nothing.
const SAFE_BATCH_BYTES = 23 * 1024 * 1024;

// Same object-stream compression the old sendInvoiceEmail backend function
// used — re-saving via pdf-lib often shrinks PDFs with redundant objects,
// with no quality loss (it's a structural re-pack, not image recompression).
async function compressPdf(bytes) {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const compressed = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return compressed.length < bytes.length ? compressed : bytes;
  } catch {
    return bytes;
  }
}

/**
 * Fetch + compress every attachment, then greedily bin-pack them into
 * batches under SAFE_BATCH_BYTES. Each batch gets its own subject/body
 * regenerated from the templates so the PO list only shows what's
 * actually in that batch's zip — plus a "(i/n)" suffix when there's more
 * than one batch. Also pre-builds each batch's zip Blob up front so the
 * later "download & open draft" step is instant.
 *
 * Returns an array of:
 *   { id, to, subject, body, poNumbers, fileNames, totalBytes, zipBlob }
 */
async function buildEmailBatches({ attachments, to, subjectTemplate, bodyTemplate, companyName, fromEmail }) {
  // Step 1: fetch + compress everything, keep the PO number alongside each file.
  const compressedFiles = [];
  for (const att of attachments) {
    let bytes;
    if (att.base64) {
      bytes = base64ToUint8Array(att.base64);
    } else if (att.url) {
      const resp = await fetch(att.url);
      if (!resp.ok) throw new Error(`Failed to fetch ${att.filename}`);
      bytes = new Uint8Array(await resp.arrayBuffer());
    } else {
      continue;
    }
    const before = bytes.length;
    bytes = await compressPdf(bytes);
    console.log(`${att.filename}: ${(before / 1024 / 1024).toFixed(1)}MB → ${(bytes.length / 1024 / 1024).toFixed(1)}MB`);
    compressedFiles.push({ filename: att.filename, poNumber: att.poNumber, bytes });
  }

  // Step 2: greedy bin-packing into batches under SAFE_BATCH_BYTES.
  const rawBatches = [];
  let current = [], currentSize = 0;
  for (const f of compressedFiles) {
    if (currentSize + f.bytes.length > SAFE_BATCH_BYTES && current.length > 0) {
      rawBatches.push(current);
      current = [f];
      currentSize = f.bytes.length;
    } else {
      current.push(f);
      currentSize += f.bytes.length;
    }
  }
  if (current.length > 0) rawBatches.push(current);

  // Step 3: build subject/body/zip per batch, scoped to that batch's own PO list.
  const batches = await Promise.all(
    rawBatches.map(async (batchFiles, i) => {
      const poNumbers = batchFiles.map((f) => f.poNumber);
      const poList = poNumbers.map((po) => `  - PO# ${po}`).join('\n');
      const suffix = rawBatches.length > 1 ? ` (${i + 1}/${rawBatches.length})` : '';

      const subject = subjectTemplate.replace('{{po_numbers}}', poNumbers.join(', ')) + suffix;
      const body = bodyTemplate
        .replace('{{po_numbers}}', poNumbers.join(', '))
        .replace('{{po_list}}', poList)
        .replace('{{company_name}}', companyName)
        + (rawBatches.length > 1 ? `\n\n[Email ${i + 1} of ${rawBatches.length} — ${batchFiles.length} attachment(s)]` : '');

      const zip = new JSZip();
      let totalBytes = 0;
      for (const f of batchFiles) {
        zip.file(f.filename, f.bytes);
        totalBytes += f.bytes.length;
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      return {
        id: `batch-${i}`,
        to,
        from: fromEmail,
        subject,
        body,
        poNumbers,
        fileNames: batchFiles.map((f) => f.filename),
        files: batchFiles.map((f) => ({ filename: f.filename, bytes: f.bytes })), // needed to build the .eml
        totalBytes,
        zipBlob,
        zipName: rawBatches.length > 1 ? `invoices_${i + 1}_of_${rawBatches.length}.zip` : 'invoices.zip',
      };
    })
  );

  return batches;
}

function downloadBatchZipAndOpenMailDraft(batch) {
  const zipUrl = URL.createObjectURL(batch.zipBlob);
  const a = document.createElement('a');
  a.href = zipUrl;
  a.download = batch.zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);

  const mailtoUrl = `mailto:${encodeURIComponent(batch.to)}?subject=${encodeURIComponent(
    batch.subject
  )}&body=${encodeURIComponent(batch.body + `\n\n(Invoices attached as ${batch.zipName} — please attach the file just downloaded.)`)}`;
  window.location.href = mailtoUrl;
}

// ---- .eml builder ----------------------------------------------------------
// mailto: links are text-only — no browser lets JS attach files to one, that's
// a platform restriction, not something workaroundable in code. But a real
// .eml file (the standard RFC 822 email format) CAN carry real attachments.
// Double-clicking a downloaded .eml opens it directly in Outlook, Apple Mail,
// or Thunderbird as a ready-to-send draft — attachments already in place, no
// manual re-attaching needed. (Doesn't apply to Gmail-web-only setups with no
// desktop mail client — the zip+mailto option above still covers that case.)

function wrapBase64(base64) {
  return base64.match(/.{1,76}/g).join('\r\n');
}

function buildEmlBlob({ from, to, subject, body, files }) {
  const boundary = `----invoice-${Date.now().toString(36)}`;
  const { encoding: bodyEncoding, body: crlfBody } = encodeTextBody(body);

  let eml = '';
  eml += `From: ${encodeAddressHeader(from)}\r\n`;
  eml += `To: ${encodeAddressHeader(to)}\r\n`;
  eml += `Subject: ${encodeHeader(subject)}\r\n`;
  // Tells (Windows desktop) Outlook to open this .eml as an editable,
  // unsent draft with a visible Send button — without this, double-clicking
  // a .eml normally opens it read-only, styled like a message you received,
  // which isn't something you can just hit Send on.
  eml += `X-Unsent: 1\r\n`;
  eml += `MIME-Version: 1.0\r\n`;
  eml += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
  eml += `\r\n`;
  eml += `--${boundary}\r\n`;
  eml += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  eml += `Content-Transfer-Encoding: ${bodyEncoding}\r\n`;
  eml += `\r\n`;
  eml += `${crlfBody}\r\n`;
  eml += `\r\n`;

  for (const f of files) {
    const base64 = wrapBase64(uint8ToBase64(f.bytes));
    eml += `--${boundary}\r\n`;
    eml += `Content-Type: application/pdf; name="${f.filename}"\r\n`;
    eml += `Content-Transfer-Encoding: base64\r\n`;
    eml += `Content-Disposition: attachment; filename="${f.filename}"\r\n`;
    eml += `\r\n`;
    eml += `${base64}\r\n`;
    eml += `\r\n`;
  }

  eml += `--${boundary}--\r\n`;

  return new Blob([eml], { type: 'message/rfc822' });
}

function downloadBatchEml(batch) {
  const emlBlob = buildEmlBlob({ from: batch.from, to: batch.to, subject: batch.subject, body: batch.body, files: batch.files });
  const emlName = batch.zipName.replace(/\.zip$/, '.eml');
  const emlUrl = URL.createObjectURL(emlBlob);
  const a = document.createElement('a');
  a.href = emlUrl;
  a.download = emlName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(emlUrl), 10000);
  return emlName;
}



// ============================================================================
// Component
// ============================================================================

export default function TjxCanada() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [fileStates, setFileStates] = useState({});
  const [isProcessingAll] = useState(false); // kept for compat
  const [emailDraft, setEmailDraft] = useState(null);
  const [isSendingMailgun, setIsSendingMailgun] = useState(false);
  const [isOpeningOutlook, setIsOpeningOutlook] = useState(false);
  const [mailgunError, setMailgunError] = useState('');
  const [emailResult, setEmailResult] = useState(null);
  const [emailBatchQueue, setEmailBatchQueue] = useState(null); // array of batches pending review, or null
  const [processedBatchIds, setProcessedBatchIds] = useState(new Set());
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitResult, setSplitResult] = useState(null);
  const [aiNote, setAiNote] = useState("");
  const inputRef = useRef(null);
  const splitInputRef = useRef(null);
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  const { data: settingsList = [] } = useQuery({
    queryKey: ['appsettings'],
    queryFn: () => base44.entities.AppSettings.list(),
  });
  const settings = settingsList[0] || {};
  const defaultTo = settings.invoice_email_to || 'apinvoices@tjxcanada.ca';
  const subjectTemplate = settings.email_template_subject || 'Invoices - POs: {{po_numbers}}';
  const bodyTemplate = settings.email_template_body || 'Dear TJX Canada Accounts Payable,\n\nPlease find the following invoices attached:\n\n{{po_list}}\n\nThank you,\n{{company_name}}';

  const { data: invoiceLogs = [], isError: invoiceLogsFailed } = useQuery({
    queryKey: ['tjxCanadaInvoiceLogs'],
    // Append-only log, one row per invoice emailed. Unbounded, it becomes
    // the slowest read in the app within a year. The UI only shows recent
    // history; search should move server-side when this cap starts biting.
    queryFn: () => base44.entities.TjxCanadaInvoiceLog.list('-sent_at', 500),
  });

  const filteredInvoiceLogs = invoiceLogs.filter(r => {
    if (!historySearch.trim()) return true;
    const q = historySearch.trim().toLowerCase();
    return [r.po_number, r.filename, r.sent_to, r.subject].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });

  const handleAiStatus = (s) => {
    if (s.phase === "done") {
      setAiNote("Used: Gemini API");
    } else if (s.message) {
      setAiNote(s.message);
    }
  };

  const addFiles = (list) => {
    const toAdd = Array.from(list || []).filter(f => f.type === "application/pdf");
    if (toAdd.length === 0) return;

    // `fresh` is computed OUTSIDE the state updater. React may invoke an
    // updater more than once (eager evaluation, StrictMode), so calling
    // processFile from inside it uploaded and billed every file twice, and the
    // second pass then marked the row as a duplicate of itself.
    const existingNames = new Set(files.map(f => f.name));
    const fresh = toAdd.filter(f => !existingNames.has(f.name));
    if (fresh.length === 0) return;

    setFiles(prev => [...prev, ...fresh]);
    fresh.forEach(f => processFile(f));
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }, []);

  const onDragOver = (e) => e.preventDefault();

  const fileStatesRef = React.useRef(fileStates);
  useEffect(() => { fileStatesRef.current = fileStates; }, [fileStates]);

  const processFile = async (file) => {
    const name = file.name;
    setFileStates(prev => ({ ...prev, [name]: { status: 'processing' } }));

    try {
      const [uploadResp, po_number] = await Promise.all([
        uploadFile({ file }),
        extractPoNumber(file, handleAiStatus),
      ]);
      const fileUrl = uploadResp.file_url;

      const existingPos = Object.values(fileStatesRef.current)
        .filter(s => s.status === 'done')
        .map(s => s.poNumber);
      if (existingPos.includes(po_number)) {
        setFileStates(prev => ({
          ...prev,
          [name]: { status: 'error', error: `Duplicate: PO# ${po_number} already added` }
        }));
        return;
      }

      const blobUrl = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));

      setFileStates(prev => ({
        ...prev,
        [name]: { status: 'done', poNumber: po_number, fileName: `${po_number}.pdf`, downloadUrl: blobUrl, fileUrl }
      }));
    } catch (err) {
      setFileStates(prev => ({
        ...prev,
        [name]: { status: 'error', error: friendlyErrorMessage(err, 'Processing failed') }
      }));
    }
  };

  const handleSplitPdf = async (file) => {
    if (!file || file.type !== 'application/pdf') return;
    setIsSplitting(true);
    try {
      const uploadResp = await uploadFile({ file });
      const fileUrl = uploadResp.file_url;

      let invoices;
      try {
        invoices = await splitCombinedPdf(fileUrl, handleAiStatus, file.name);
      } catch (splitErr) {
        alert('Split error: ' + friendlyErrorMessage(splitErr, 'Could not split PDF'));
        return;
      }

      if (!invoices || invoices.length === 0) { alert('No invoices found in PDF.'); return; }

      const newVirtualFiles = [];
      const newStates = {};
      const skipped = [];
      for (const inv of invoices) {
        const virtualName = `split::${inv.po_number}::${file.name}`;

        // Dropping the same combined PDF twice — the obvious response to output
        // that looks wrong — used to append a second copy of every invoice, with
        // no duplicate check, unlike the two adjacent code paths which both have
        // one. On the email path TJX then received every invoice twice; on the
        // zip path two identical filenames collapse to one, so if the pair came
        // from different sources a real invoice was silently dropped.
        if (fileStates[virtualName] || files.some(f => f.name === virtualName)) {
          skipped.push(inv.po_number);
          continue;
        }

        const byteChars = atob(inv.base64_pdf);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArr], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        newVirtualFiles.push({ name: virtualName, isVirtual: true });
        newStates[virtualName] = {
          status: 'done',
          poNumber: inv.po_number,
          fileName: `${inv.po_number}.pdf`,
          downloadUrl: blobUrl,
          base64Pdf: inv.base64_pdf,
          pageNote: `${inv.pages} page${inv.pages !== 1 ? 's' : ''} · from ${file.name}`,
          isVirtual: true,
        };
      }

      setFiles(prev => [...prev, ...newVirtualFiles]);
      setFileStates(prev => ({ ...prev, ...newStates }));

      setSplitResult({
        count: newVirtualFiles.length,
        pos: newVirtualFiles.map(f => fileStates[f.name]?.poNumber ?? newStates[f.name]?.poNumber).filter(Boolean).join(', '),
        skipped,
      });
    } catch (err) {
      alert('Error: ' + friendlyErrorMessage(err, 'Unknown error'));
    } finally {
      setIsSplitting(false);
    }
  };

  const retryErrors = () => {
    const toRetry = files.filter(f => !f.isVirtual && fileStates[f.name]?.status === 'error');
    toRetry.forEach(f => processFile(f));
  };

  const removeFile = (name) => {
    setFiles(prev => prev.filter(f => f.name !== name));
    setFileStates(prev => {
      const s = { ...prev };
      // Each processed invoice holds an object URL for its split PDF. Dropping
      // the state without revoking leaked the whole PDF for the life of the
      // tab, and a long TJX session processes dozens of them.
      if (s[name]?.downloadUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(s[name].downloadUrl);
      }
      delete s[name];
      return s;
    });
  };

  const pendingCount = files.filter(f => !f.isVirtual && fileStates[f.name]?.status === 'error').length;
  const doneFiles = files.filter(f => fileStates[f.name]?.status === 'done');

  const openEmailDraft = () => {
    const poNumbers = doneFiles.map(f => fileStates[f.name].poNumber);
    const poList = poNumbers.map(po => `  - PO# ${po}`).join('\n');
    const companyName = settings.company_name || 'Shipping Hub';

    const subject = subjectTemplate.replace('{{po_numbers}}', poNumbers.join(', '));
    const body = bodyTemplate
      .replace('{{po_numbers}}', poNumbers.join(', '))
      .replace('{{po_list}}', poList)
      .replace('{{company_name}}', companyName);

    setEmailDraft({ to: defaultTo, subject, body });
  };

  const handleSendMailgun = async () => {
    setIsSendingMailgun(true);
    setMailgunError('');
    try {
      const attachments = doneFiles.map(f => {
        const st = fileStates[f.name];
        if (st.base64Pdf) {
          return { base64: st.base64Pdf, filename: st.fileName };
        }
        return { url: st.fileUrl, filename: st.fileName };
      });
      const invoiceFromEmail = settings.invoice_from_email || undefined;
      const invoiceFromName = settings.invoice_from_name || undefined;
      const resp = await base44.functions.invoke('sendInvoiceEmail', {
        to: emailDraft.to,
        subject: emailDraft.subject,
        body: emailDraft.body,
        attachments,
        ...(invoiceFromEmail && { from_email: invoiceFromEmail }),
        ...(invoiceFromName && { from_name: invoiceFromName }),
      });
      const { emails_sent = 1 } = resp || {};
      setEmailDraft(null);
      setEmailResult({ to: emailDraft.to, batches: emails_sent, viaMailgun: true });

      // Save a searchable record of every invoice just sent.
      archiveInvoiceRecords({
        files: doneFiles.map(f => {
          const st = fileStates[f.name];
          return { filename: st.fileName, poNumber: st.poNumber, fileUrl: st.fileUrl, base64Pdf: st.base64Pdf };
        }),
        to: emailDraft.to,
        subject: emailDraft.subject,
        sendMethod: 'mailgun',
      }).then(() => {
        qc.invalidateQueries({ queryKey: ['tjxCanadaInvoiceLogs'] });
      });
    } catch (err) {
      // No silent auto-fallback — surface the error right in the dialog so
      // the person can decide whether to retry Mailgun or just click
      // "Open in Outlook" instead.
      setMailgunError(friendlyErrorMessage(err, 'Unknown error'));
    } finally {
      setIsSendingMailgun(false);
    }
  };

  const handleOpenOutlook = async () => {
    setIsOpeningOutlook(true);
    setMailgunError('');
    try {
      const attachments = doneFiles.map(f => {
        const st = fileStates[f.name];
        if (st.base64Pdf) {
          return { base64: st.base64Pdf, filename: st.fileName, poNumber: st.poNumber };
        }
        return { url: st.fileUrl, filename: st.fileName, poNumber: st.poNumber };
      });

      const companyName = settings.company_name || 'Shipping Hub';
      const batches = await buildEmailBatches({
        attachments,
        to: emailDraft.to,
        subjectTemplate,
        bodyTemplate,
        companyName,
        fromEmail: settings.invoice_from_email || 'mhart@capitalnutrition.ca',
      });

      // Show every email for review BEFORE any download or mail-client
      // action happens — nothing is sent yet at this point.
      setProcessedBatchIds(new Set());
      setEmailBatchQueue(batches);
      setEmailDraft(null);
    } catch (err) {
      alert('Error: ' + friendlyErrorMessage(err, 'Unknown error'));
    } finally {
      setIsOpeningOutlook(false);
    }
  };

  const handleDownloadEml = (batch) => {
    downloadBatchEml(batch);
    setProcessedBatchIds(prev => new Set(prev).add(batch.id));
  };

  const handleDownloadZipFallback = (batch) => {
    downloadBatchZipAndOpenMailDraft(batch);
    setProcessedBatchIds(prev => new Set(prev).add(batch.id));
  };

  const closeBatchQueue = () => {
    const allDone = emailBatchQueue && processedBatchIds.size === emailBatchQueue.length;
    if (allDone) {
      setEmailResult({ to: emailBatchQueue[0]?.to, batches: emailBatchQueue.length, fallback: true });

      // Save a searchable record of every invoice across every batch.
      const archiveJobs = emailBatchQueue.map(batch =>
        archiveInvoiceRecords({
          files: batch.files.map((f, i) => ({ filename: f.filename, poNumber: batch.poNumbers[i], bytes: f.bytes })),
          to: batch.to,
          subject: batch.subject,
          // 'downloaded', not 'outlook'. This path writes a .eml to disk for the
          // user to open in their mail client. Recording it as sent, with a
          // timestamp, made the archive assert a delivery that may never have
          // happened — and the archive is what gets consulted when someone asks
          // whether an invoice went out.
          sendMethod: 'downloaded',
        })
      );
      Promise.all(archiveJobs).then(() => {
        qc.invalidateQueries({ queryKey: ['tjxCanadaInvoiceLogs'] });
      });
    }
    setEmailBatchQueue(null);
    setProcessedBatchIds(new Set());
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">TJX Canada Invoice Processor</h1>
          <p className="text-gray-400 text-xs">Upload PDF invoices — AI extracts the PO number and renames for download.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          History {invoiceLogs.length > 0 && <span className="ml-0.5 text-xs text-gray-400">({invoiceLogs.length})</span>}
        </Button>
      </div>
      <div className="max-w-3xl mx-auto p-6">

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors bg-white"
          >
            <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
            <FileUp className="mx-auto h-8 w-8 text-gray-400 mb-2" />
            <p className="font-medium text-gray-700 text-sm">Individual Invoices</p>
            <p className="text-xs text-gray-400 mt-1">One PDF per invoice · Multiple files</p>
          </div>

          <div
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleSplitPdf(e.dataTransfer.files[0]); }}
            onDragOver={e => e.preventDefault()}
            onClick={() => splitInputRef.current?.click()}
            className="border-2 border-dashed border-purple-300 rounded-xl p-8 text-center cursor-pointer hover:border-purple-500 hover:bg-purple-50 transition-colors bg-white relative"
          >
            <input ref={splitInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => { if (e.target.files[0]) handleSplitPdf(e.target.files[0]); e.target.value = ''; }} />
            {isSplitting
              ? <Loader2 className="mx-auto h-8 w-8 text-purple-400 mb-2 animate-spin" />
              : <Scissors className="mx-auto h-8 w-8 text-purple-400 mb-2" />}
            <p className="font-medium text-purple-700 text-sm">Combined PDF Splitter</p>
            <p className="text-xs text-gray-400 mt-1">One PDF with multiple invoices · AI splits by PO</p>
            {isSplitting && <p className="text-xs text-purple-500 mt-1 animate-pulse">Analyzing & splitting...</p>}
          </div>
        </div>

        {aiNote && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <p className="text-sm text-blue-700">{aiNote}</p>
          </div>
        )}

        {splitResult && (
          <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <Scissors className="h-5 w-5 text-purple-500 flex-shrink-0" />
            <p className="text-sm text-purple-700">
              Split into <strong>{splitResult.count}</strong> invoice{splitResult.count !== 1 ? 's' : ''}
              {splitResult.pos ? `: ${splitResult.pos}` : ''}
              {splitResult.skipped?.length > 0 && (
                <span className="block text-purple-500 mt-0.5">
                  Already loaded, not added again: {splitResult.skipped.join(', ')}
                </span>
              )}
            </p>
            <button onClick={() => setSplitResult(null)} className="ml-auto text-purple-400 hover:text-purple-600"><X className="h-4 w-4" /></button>
          </div>
        )}

        {emailResult && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-700">
              {emailResult.fallback
                ? `${emailResult.batches} email${emailResult.batches !== 1 ? 's' : ''} to ${emailResult.to} downloaded — open the .eml file(s) to send directly, or attach the zip manually if you used that option.`
                : emailResult.batches > 1
                ? `Sent in ${emailResult.batches} emails to ${emailResult.to} (split to stay under 50MB per email)`
                : `Email sent successfully to ${emailResult.to}`}
            </p>
            <button onClick={() => setEmailResult(null)} className="ml-auto text-green-400 hover:text-green-600"><X className="h-4 w-4" /></button>
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-6 space-y-3">
            {files.map(file => {
              const state = fileStates[file.name] || {};
              return (
                <div key={file.name} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3 shadow-sm">
                  <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {file.isVirtual ? <span className="text-purple-600">[split] </span> : null}
                      {file.isVirtual ? (fileStates[file.name]?.fileName || file.name) : file.name}
                    </p>
                    {state.poNumber && (
                      <p className="text-xs text-gray-500">
                        PO: <span className="font-semibold text-gray-700">{state.poNumber}</span> → {state.fileName}
                        {state.pageNote && <span className="text-purple-500 ml-1">· {state.pageNote}</span>}
                      </p>
                    )}
                    {state.status === 'error' && (
                      <p className="text-xs text-red-500">{state.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {state.status === 'processing' && (
                      <span className="text-xs text-blue-500 flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Processing...
                      </span>
                    )}
                    {state.status === 'done' && (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <a href={state.downloadUrl} download={state.fileName} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50 h-7 text-xs">
                            <Download className="h-3 w-3 mr-1" /> Download
                          </Button>
                        </a>
                      </>
                    )}
                    {state.status === 'error' && <AlertCircle className="h-4 w-4 text-red-400" />}
                    <button onClick={() => removeFile(file.name)} className="text-gray-300 hover:text-gray-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}

            {pendingCount > 0 && (
              <Button onClick={retryErrors} variant="outline" className="w-full mt-2 border-red-300 text-red-700 hover:bg-red-50">
                Retry {pendingCount} Failed Invoice{pendingCount !== 1 ? 's' : ''}
              </Button>
            )}

            {doneFiles.length > 0 && (
              <Button
                onClick={openEmailDraft}
                variant="outline"
                className="w-full mt-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Mail className="h-4 w-4 mr-2" />
                Email {doneFiles.length} Invoice{doneFiles.length !== 1 ? 's' : ''} to {defaultTo}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!emailDraft} onOpenChange={() => setEmailDraft(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review & Send Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Attachments ({doneFiles.length})</Label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-36 overflow-y-auto">
                {doneFiles.map(f => {
                  const st = fileStates[f.name];
                  return (
                    <div key={f.name} className="flex items-center gap-2 px-3 py-1.5">
                      <FileText className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                      <span className="text-xs text-gray-700 flex-1 truncate">{st.fileName}</span>
                      {st.downloadUrl && (
                        <a href={st.downloadUrl} download={st.fileName} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex-shrink-0">preview</a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {(settings.invoice_from_name || settings.invoice_from_email) && (
              <div className="border rounded-lg bg-gray-50 px-3 py-2 text-xs space-y-0.5">
                <div><span className="text-gray-500">From:</span> <span className="font-medium">{settings.invoice_from_name ? `${settings.invoice_from_name}${settings.invoice_from_email ? ` <${settings.invoice_from_email}>` : ""}` : settings.invoice_from_email}</span></div>
              </div>
            )}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">To</Label>
              <Input value={emailDraft?.to || ''} onChange={e => setEmailDraft(d => ({ ...d, to: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Subject</Label>
              <Input value={emailDraft?.subject || ''} onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Body</Label>
              <Textarea
                value={emailDraft?.body || ''}
                onChange={e => setEmailDraft(d => ({ ...d, body: e.target.value }))}
                rows={8}
                className="text-sm"
              />
            </div>
            {mailgunError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span className="flex-1">{mailgunError}</span>
              </div>
            )}
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setEmailDraft(null)}>Cancel</Button>
            <Button
              variant="outline"
              onClick={handleSendMailgun}
              disabled={isSendingMailgun || isOpeningOutlook}
              className="border-teal-300 text-teal-700 hover:bg-teal-50"
            >
              {isSendingMailgun ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send via Mailgun</>}
            </Button>
            <Button onClick={handleOpenOutlook} disabled={isSendingMailgun || isOpeningOutlook}>
              {isOpeningOutlook ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Preparing...</> : <><Mail className="h-4 w-4 mr-2" />Open in Outlook</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Review Dialog — shown when backend email sending is blocked.
          Every email that will be produced is listed here, with its own
          recipient/subject/body/attachment list, BEFORE anything is
          downloaded or a mail draft is opened. Each row is processed
          individually since a browser can only download one zip and open
          one mailto: draft per user action. */}
      <Dialog open={!!emailBatchQueue} onOpenChange={(open) => { if (!open) closeBatchQueue(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review {emailBatchQueue?.length || 0} Email{(emailBatchQueue?.length || 0) !== 1 ? 's' : ''} Before Sending
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 -mt-2 mb-2">
            Invoices were split into
            {emailBatchQueue?.length > 1 ? ` ${emailBatchQueue.length} emails` : ' one email'} to stay under the
            ~23MB attachment limit. Each row below is a separate email — review them all, then process each one.
            The <strong>.eml</strong> option opens as a ready-to-send draft in Outlook (or Apple Mail/Thunderbird)
            with attachments already in place; use the zip option instead if you're on Gmail/webmail with no
            desktop client.
          </p>
          <div className="space-y-4 py-2">
            {emailBatchQueue?.map((batch, i) => {
              const done = processedBatchIds.has(batch.id);
              return (
                <div key={batch.id} className={`border rounded-lg p-4 space-y-2 ${done ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">
                      Email {i + 1} of {emailBatchQueue.length}
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        ({(batch.totalBytes / 1024 / 1024).toFixed(1)}MB · {batch.fileNames.length} file{batch.fileNames.length !== 1 ? 's' : ''})
                      </span>
                    </span>
                    {done && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Downloaded</span>}
                  </div>
                  <div className="text-xs space-y-1">
                    <div><span className="text-gray-500">To:</span> <span className="font-medium">{batch.to}</span></div>
                    <div><span className="text-gray-500">Subject:</span> <span className="font-medium">{batch.subject}</span></div>
                  </div>
                  <Textarea value={batch.body} readOnly rows={4} className="text-xs bg-gray-50" />
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-24 overflow-y-auto">
                    {batch.fileNames.map((fn) => (
                      <div key={fn} className="flex items-center gap-2 px-3 py-1">
                        <FileText className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                        <span className="text-xs text-gray-700 truncate">{fn}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1 min-w-[220px]"
                      onClick={() => handleDownloadEml(batch)}
                    >
                      <Mail className="h-3.5 w-3.5 mr-2" />
                      {done ? 'Re-download .eml' : `Download Email #${i + 1} (.eml, attachments included)`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadZipFallback(batch)}
                      title="For Gmail/webmail with no desktop mail client"
                    >
                      <Download className="h-3.5 w-3.5 mr-2" />
                      Zip only
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBatchQueue}>
              {emailBatchQueue && processedBatchIds.size === emailBatchQueue.length ? 'Done' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice History — searchable archive of every invoice sent (either
          send path), backed by the TjxCanadaInvoiceLog entity. */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Invoice History ({invoiceLogs.length})</DialogTitle>
          </DialogHeader>
          <div className="relative flex-shrink-0">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              placeholder="Search PO #, filename, recipient, subject…"
              className="pl-9 h-9"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 py-2">
            {invoiceLogsFailed && (
              <p className="text-center text-red-600 py-8 text-sm">
                The invoice history could not be loaded. It may not be empty — try reloading.
              </p>
            )}
            {!invoiceLogsFailed && invoiceLogs.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">No invoices sent yet.</p>
            )}
            {invoiceLogs.length > 0 && filteredInvoiceLogs.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">No invoices match your search.</p>
            )}
            {filteredInvoiceLogs.map(r => (
              <div key={r.id} className="border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-3 text-sm">
                <FileText className="h-4 w-4 text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">PO# {r.po_number || '—'}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${r.send_method === 'mailgun' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-800'}`}
                          title={r.send_method === 'mailgun' ? 'Delivered by Mailgun' : 'A .eml file was downloaded — delivery not confirmed'}>
                      {r.send_method === 'mailgun' ? 'Sent' : 'Downloaded'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{r.filename} · to {r.sent_to} · {r.sent_at ? new Date(r.sent_at).toLocaleString() : ''}</p>
                </div>
                {r.pdf_url && (
                  /* Re-signed on click. The stored URL is a 7-day signed link;
                     following it directly returned an error on day 8, which
                     read as the file having been deleted. */
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const fresh = await base44.integrations.Core.ResolveFileUrl(r.pdf_url);
                        window.open(fresh, '_blank', 'noopener,noreferrer');
                      } catch (err) {
                        alert(friendlyErrorMessage(err, 'Could not open that file.'));
                      }
                    }}
                    className="text-xs text-blue-600 hover:underline flex-shrink-0"
                  >
                    Open ↗
                  </button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}