import { createClientFromRequest, json, serve, HttpError } from '../_shared/base44-compat.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const MAX_INVOICES_PER_DOCUMENT = 50;

function cleanPO(val) {
  const po = (val || '').trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9\-]/g, '').toUpperCase();
  return po.length >= 3 ? po : null;
}

function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const LLM_PROMPT = (pageCount) => `This PDF has ${pageCount} page(s). Analyze the document visually and identify which pages belong to each invoice, and extract the PO number for each.

STRICT RULES for finding PO number:
- Look ONLY for fields explicitly labeled "Purchase Order Number:", "PO Number:", "P.O. #", "PO#", or "PO No"
- Do NOT use "Order #", "Order Number", "Order No", "Invoice #", or "Invoice Number" — those are different fields
- The PO number may have spaces (e.g. "25 118504") — remove spaces and return only the digits/letters
- Return one entry per distinct invoice. If there is only 1 invoice, return 1 entry.
- page_start and page_end are 1-based page numbers (page_end is inclusive)`;

serve(async (req) => {
  try {
    const base44 = await createClientFromRequest(req);
    const user = await base44.auth.me(); // throws 401 if the JWT is missing/expired

    const { file_url, file_name } = await req.json();
    if (!file_url) return json(req, { error: 'No file_url provided' }, 400);

    console.log(`Splitting: ${file_name}`);

    // Fetch PDF bytes first (needed for page count before LLM)
    const pdfResp = await fetch(file_url);
    if (!pdfResp.ok) return json(req, { error: `Failed to fetch PDF: ${pdfResp.status}` }, 400);
    const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());

    if (String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3]) !== '%PDF') {
      return json(req, { error: 'Not a valid PDF file' }, 400);
    }

    // Load PDF and call LLM vision in parallel
    const [srcDoc, llmResult] = await Promise.all([
      PDFDocument.load(pdfBytes, { ignoreEncryption: true }),
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: LLM_PROMPT(0), // page count unknown yet, but LLM sees the actual file
        file_urls: [file_url],
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
                  page_end: { type: 'number' }
                },
                required: ['po_number', 'page_start', 'page_end']
              }
            }
          }
        }
      })
    ]);

    const pageCount = srcDoc.getPageCount();
    console.log(`Page count: ${pageCount}`);
    if (pageCount === 0) return json(req, { error: 'PDF has no pages' }, 400);

    const rawInvoices = llmResult?.invoices || [];
    console.log(`LLM identified ${rawInvoices.length} invoice(s): ${JSON.stringify(rawInvoices)}`);
    if (rawInvoices.length === 0) {
      return json(req, { error: 'Could not identify invoices in this PDF.' }, 400);
    }

    // The model decides how many invoices are in the document. Cap it: a
    // hallucinated 200-entry array would spawn 200 concurrent pdf-lib
    // documents and a response several hundred MB after base64 inflation.
    if (rawInvoices.length > MAX_INVOICES_PER_DOCUMENT) {
      throw new HttpError(
        `This document appears to contain ${rawInvoices.length} invoices, which is more than can be processed at once (max ${MAX_INVOICES_PER_DOCUMENT}). Split the file and try again.`,
        422,
      );
    }

    const skipped: string[] = [];

    // Split all invoices in parallel
    const splitResults = await Promise.all(rawInvoices.map(async (inv) => {
      const po = cleanPO(inv.po_number);
      if (!po) return null;

      // Page numbers come from the model and were previously trusted. An
      // inverted or out-of-range range produced an EMPTY pdf that was then
      // emailed to the customer as their invoice.
      const rawStart = Number(inv.page_start);
      const rawEnd = Number(inv.page_end);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
        skipped.push(`${po} (no page range)`);
        return null;
      }
      const start = Math.min(Math.max(1, Math.round(rawStart)), pageCount) - 1;
      const end = Math.min(Math.max(1, Math.round(rawEnd)), pageCount) - 1;
      if (end < start) {
        skipped.push(`${po} (pages ${start + 1}-${end + 1} out of order)`);
        return null;
      }

      const splitDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let i = start; i <= end; i++) pageIndices.push(i);
      if (pageIndices.length === 0) {
        skipped.push(`${po} (empty page range)`);
        return null;
      }

      try {
        const copiedPages = await splitDoc.copyPages(srcDoc, pageIndices);
        copiedPages.forEach(p => splitDoc.addPage(p));
        const splitBytes = await splitDoc.save();
        const base64Pdf = uint8ToBase64(splitBytes);
        console.log(`Done: PO=${po}, pages ${start + 1}-${end + 1}, size=${splitBytes.length}`);
        return { po_number: po, base64_pdf: base64Pdf, pages: pageIndices.length };
      } catch (splitError) {
        // One bad range must not reject the whole batch and discard the
        // invoices that split correctly.
        skipped.push(`${po} (${(splitError as Error).message})`);
        return null;
      }
    }));

    const results = splitResults.filter(Boolean);
    if (results.length === 0) {
      return json(req, { error: 'Could not extract PO numbers from invoices in this PDF.' }, 400);
    }

    return json(req, {
      invoices: results,
      total: results.length,
      // Surfaced so the caller can tell the user which invoices did NOT come
      // out of the document, instead of silently sending fewer than expected.
      skipped,
    });

  } catch (error) {
    // serve() maps HttpError.status correctly; hardcoding 500 here made
    // every auth or validation failure look like a server crash.
    throw error;
  }
});