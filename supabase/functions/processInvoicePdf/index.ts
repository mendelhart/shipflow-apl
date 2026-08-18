import { createClientFromRequest, json, serve, HttpError } from '../_shared/base44-compat.ts';

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
  // Remove spaces within the value (e.g. "25 118504" → "25118504")
  const po = (val || '').trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9\-]/g, '').toUpperCase();
  return po.length >= 3 ? po : null;
}

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.message?.includes('Rate limit') || err?.status === 429 || String(err).includes('429');
      if (isRateLimit && attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

function tryRegex(text) {
  // Strip spaces within number sequences (e.g. "25 118504" → "25118504", "20 572020" → "20572020")
  const normalizedText = text.replace(/(\d)\s+(\d)/g, '$1$2').replace(/(\d)\s+(\d)/g, '$1$2');

  // Priority 1: "Purchase Order Number:" label (most specific, appears in Payment Method section)
  // Also handles "Purchase Order Number: PO Number: XXXXXXXX"
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
  // DO NOT fall back to "Order #" here — let LLM handle ambiguous cases
  return null;
}

serve(async (req) => {
  try {
    const base44 = await createClientFromRequest(req);
    const user = await base44.auth.me(); // throws 401 if the JWT is missing/expired

    const { file_url, file_name, file_base64 } = await req.json();
    if (!file_url) return json(req, { error: 'No file_url provided' }, 400);

    console.log(`Processing: ${file_name}`);

    // Support base64-encoded PDF passed directly (avoids a second network round-trip)
    let pdfBytes;
    if (file_base64) {
      const binary = atob(file_base64);
      pdfBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) pdfBytes[i] = binary.charCodeAt(i);
    } else {
      const pdfResp = await fetch(file_url);
      if (!pdfResp.ok) return json(req, { error: `Failed to fetch PDF: ${pdfResp.status}` }, 400);
      pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
    }

    if (String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3]) !== '%PDF') {
      return json(req, { error: 'Not a valid PDF file' }, 400);
    }

    // Stage 1: Local text extraction + regex (free, instant)
    const { text: localText, raw } = extractLocalText(pdfBytes);
    console.log(`Local text (${localText.length} chars): ${localText.slice(0, 500)}`);

    if (localText.length >= 10) {
      console.log(`Local text sample: ${localText.slice(0, 500)}`);
      const po = tryRegex(localText);
      if (po) { console.log(`Regex hit: ${po}`); return json(req, { po_number: po }); }
      console.log('No regex match, falling back to LLM');
    }

    // Stage 2: LLM call with retry
    console.log('LLM extraction...');
    const textToSend = localText.length >= 30 ? localText : raw.replace(/[^\x20-\x7E\n]/g, ' ');
    const snippet = textToSend.slice(0, 6000);

    let poNumber = null;
    try {
      const result = await withRetry(() =>
        base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Extract the TJX Canada Purchase Order number from this invoice text.\n\nSTRICT RULES:\n- Look specifically for a field labeled "Purchase Order Number:", "PO Number:", "P.O. #", "PO#", or "PO No" — this is usually in the Payment Method section\n- Do NOT return a number labeled "Order #", "Order Number", "Order No", "Invoice #", or "Invoice Number" — those are DIFFERENT fields and must be ignored\n- The number may have spaces in it (e.g. "25 118504" or "20 572020") — remove the spaces and return only digits\n- The PO number is typically 7-9 digits when spaces are removed (e.g. 25118504, 20572020)\n- Return ONLY the digits with no spaces or other characters. If you cannot find a field explicitly labeled as PO or Purchase Order Number, return empty string.\n\nText:\n${snippet}`,
          response_json_schema: { type: 'object', properties: { po_number: { type: 'string' } } }
        })
      );
      poNumber = cleanPO(result?.po_number);
    } catch (err) {
      console.log(`LLM failed: ${err.message}`);
    }

    if (!poNumber) {
      console.log('No PO found');
      return json(req, { error: 'Could not find a Purchase Order number in this document.' }, 400);
    }

    console.log(`Found PO: ${poNumber}`);
    return json(req, { po_number: poNumber });

  } catch (error) {
    // serve() maps HttpError.status correctly; hardcoding 500 here made
    // every auth or validation failure look like a server crash.
    throw error;
  }
});