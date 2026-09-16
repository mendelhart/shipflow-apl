/**
 * Carton labels, drawn as vectors.
 *
 * WHY THIS EXISTS
 * The previous implementation rendered one DOM label per carton and then ran
 * html2canvas over each one. Live purchase orders in this dataset reach 2,128
 * cartons, which meant roughly 210,000 DOM nodes and 2,128 sequential
 * rasterisations, each retained as a lossless bitmap inside a single jsPDF
 * document. That reliably exhausts the tab.
 *
 * Drawing the label directly is a better fit anyway: it is text and rectangles.
 * The output is sharper (vector text and bars rather than a screenshot), the
 * file is orders of magnitude smaller, and 2,000 labels take a second or two
 * instead of minutes.
 *
 * The barcode encoding, addresses and field list all come from shared modules
 * (@/domain/upc, @/domain/labelContent), so what you preview on screen and what
 * lands on the carton cannot disagree.
 */

import { normalizeUpc, encodeUpcBars, QUIET_MODULES } from '@/domain/upc';
import { FROM_ADDRESS, shipToFor, labelCells, labelPlan, KNOWN_PREFIXES } from '@/domain/labelContent';

// 4in x 6in at 72pt/in.
const PAGE_W = 288;
const PAGE_H = 432;

const PAD = 4.5;      // 6px
const GAP = 3;        // 4px
const BORDER = 1.5;   // 2px
const INNER = 3;      // padding inside each bordered box

// px -> pt at the 96dpi the CSS was authored against.
const pt = (px) => px * 0.75;

const FONT = 'helvetica'; // metric-compatible stand-in for Arial

// UPC-A at 100% magnification: 0.33mm module, 25.9mm bar height (GS1 spec).
// 1pt = 0.3528mm.
const MM_PER_PT = 0.3528;
const NOMINAL_MODULE_PT = 0.33 / MM_PER_PT;  // ~0.935pt
const NOMINAL_BAR_H_PT = 25.9 / MM_PER_PT;   // ~73.4pt
// GS1 permits 0.80x-2.00x. Cartons are scanned at a distance in a warehouse,
// so aim high within spec rather than at nominal.
const MAX_MAG = 2.0;
const TARGET_MAG = 1.8;

/**
 * Size a UPC-A symbol for the space available, preserving its aspect ratio.
 * Exported so the spec compliance can be asserted without rendering a PDF.
 *
 * @returns {{mag:number, moduleW:number, barH:number, barsW:number, inSpec:boolean}}
 */
export function barcodeGeometry({ availW, availH, bars = 95, quiet = QUIET_MODULES }) {
  const modules = bars + quiet * 2;
  const mag = Math.min(
    TARGET_MAG,
    MAX_MAG,
    availW / (modules * NOMINAL_MODULE_PT),
    availH / NOMINAL_BAR_H_PT
  );
  return {
    mag,
    moduleW: NOMINAL_MODULE_PT * mag,
    barH: NOMINAL_BAR_H_PT * mag,
    barsW: bars * NOMINAL_MODULE_PT * mag,
    inSpec: mag >= 0.8 && mag <= 2.0,
  };
}

function box(doc, x, y, w, h) {
  doc.setLineWidth(BORDER);
  doc.setDrawColor(0);
  doc.rect(x, y, w, h);
}

/** Centre a run of lines inside a box, returning the y after the last line. */
function centredLines(doc, lines, x, w, y, lineHeight) {
  lines.forEach((line, i) => {
    doc.text(String(line ?? ''), x + w / 2, y + lineHeight * (i + 0.8), {
      align: 'center',
      baseline: 'alphabetic',
    });
  });
  return y + lineHeight * lines.length;
}

/**
 * Draw one label onto the current page.
 * Mirrors the CSS grid in CartonLabel.jsx top-to-bottom.
 */
function drawLabel(doc, { po, item, boxNumber, totalBoxes }) {
  const x = PAD;
  const w = PAGE_W - PAD * 2;
  let y = PAD;

  /* ---- Box N of M ---- */
  const headerH = pt(20) + INNER * 2 + 4;
  box(doc, x, y, w, headerH);
  doc.setFont(FONT, 'bold').setFontSize(pt(20));
  doc.text(`Box ${boxNumber} of ${totalBoxes}`, x + w / 2, y + headerH / 2 + pt(20) * 0.36, {
    align: 'center',
  });
  y += headerH + GAP;

  /* ---- FROM ---- */
  const fromLines = FROM_ADDRESS.split('\n');
  const fromLH = pt(10) * 1.3;
  const fromH = pt(9) * 1.3 + fromLines.length * fromLH + INNER * 2;
  box(doc, x, y, w, fromH);
  doc.setFont(FONT, 'bold').setFontSize(pt(9));
  doc.text('FROM:', x + w / 2, y + INNER + pt(9), { align: 'center' });
  doc.setFontSize(pt(10));
  centredLines(doc, fromLines, x, w, y + INNER + pt(9) * 1.3, fromLH);
  y += fromH + GAP;

  /* ---- SHIP TO ---- */
  const shipLines = shipToFor(po).split('\n');
  const shipLH = pt(10) * 1.3;
  const shipH = pt(10) * 1.3 + shipLines.length * shipLH + INNER * 2;
  box(doc, x, y, w, shipH);
  doc.setFont(FONT, 'bold').setFontSize(pt(10));
  doc.text('SHIP TO:', x + w / 2, y + INNER + pt(10), { align: 'center' });
  doc.setFont(FONT, 'normal');
  centredLines(doc, shipLines, x, w, y + INNER + pt(10) * 1.3, shipLH);
  y += shipH + GAP;

  /* ---- 2-column field grid ---- */
  const cells = labelCells(po, item);
  const colGap = pt(3);
  const cellW = (w - colGap) / 2;
  const cellH = pt(10) * 2.2 + INNER * 2;
  cells.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + col * (cellW + colGap);
    const cy = y + row * (cellH + colGap);
    box(doc, cx, cy, cellW, cellH);
    doc.setFont(FONT, 'bold').setFontSize(pt(10));
    doc.text(label, cx + cellW / 2, cy + INNER + pt(10), { align: 'center' });
    doc.setFont(FONT, 'normal');
    // Long values (a wordy vendor style) shrink rather than overflow the cell.
    let size = pt(10);
    let text = String(value ?? '');
    while (size > 4 && doc.getStringUnitWidth(text) * size > cellW - INNER * 2) {
      size -= 0.5;
    }
    doc.setFontSize(size);
    doc.text(text, cx + cellW / 2, cy + INNER + pt(10) * 2.1, { align: 'center' });
  });
  y += Math.ceil(cells.length / 2) * (cellH + colGap) - colGap + GAP;

  /* ---- Description ---- */
  doc.setFont(FONT, 'bold').setFontSize(pt(14));
  // Capped at 4 lines. An unbounded description consumed the space the barcode
  // needs: at ~330 characters the symbol dropped below the GS1 minimum, and at
  // ~490 the barcode box failed its size guard and the whole run printed with
  // no barcode at all, reported as success. The barcode is the point of the
  // label; the description is not allowed to crowd it out.
  const MAX_DESC_LINES = 4;
  const allDescLines = doc.splitTextToSize(String(item?.description ?? ''), w - INNER * 2 - BORDER * 2);
  const descLines = allDescLines.slice(0, MAX_DESC_LINES);
  if (allDescLines.length > MAX_DESC_LINES) {
    descLines[MAX_DESC_LINES - 1] = `${String(descLines[MAX_DESC_LINES - 1]).replace(/\s+\S*$/, '')}…`;
  }
  const descLH = pt(14) * 1.2;
  const descH = descLines.length * descLH + INNER * 2;
  box(doc, x, y, w, descH);
  centredLines(doc, descLines, x, w, y + INNER, descLH);
  y += descH + GAP;

  /* ---- Barcode ---- */
  const barcodeH = PAGE_H - PAD - y;
  if (barcodeH > 20) {
    box(doc, x, y, w, barcodeH);
    const upc = normalizeUpc(item?.upc_code);
    if (!upc.isEmpty) {
      const bars = encodeUpcBars(upc.code);

      const digitsH = pt(10) * 1.4;
      const warnH = upc.checkMismatch ? pt(8) * 1.4 : 0;
      const availW = w - INNER * 4;
      const availH = barcodeH - INNER * 2 - digitsH - warnH;

      // Both dimensions come from ONE magnification factor.
      //
      // This previously set the module width to a flat 2pt and then let the bar
      // height be "whatever is left on the page". Two consequences: the symbol
      // came out 2.64in wide, which is 2.14x nominal and outside the 0.8x-2.0x
      // magnification UPC-A permits; and its height had no relationship to its
      // width, so a label with a short description stretched the bars down the
      // page while a long one squashed them. Scanners read the ratio, and print
      // shops reject out-of-spec symbols.
      const geo = barcodeGeometry({ availW, availH, bars: bars.length });
      if (!geo.inSpec) {
        // inSpec was computed, exported and documented, and never once checked
        // at the only call site. availH is whatever the description left over,
        // so a long description silently drove real print runs below 0.8x.
        throw new Error(
          `The description on ${item?.item_number || 'an item'} is too long to fit a ` +
          `scannable barcode on a 4x6 label (magnification would be ${geo.mag.toFixed(2)}x, ` +
          `below the 0.80x minimum). Shorten it in Products and print again.`
        );
      }
      const { moduleW, barH } = geo;
      const barsW = bars.length * moduleW;
      const bx = x + (w - barsW) / 2;
      // Centre the symbol in whatever space is left rather than pinning it to
      // the top, so the label reads the same whatever the description length.
      const blockH = barH + digitsH + warnH;
      const by = y + Math.max(INNER, (barcodeH - blockH) / 2);

      doc.setFillColor(0);
      for (let i = 0; i < bars.length; i += 1) {
        if (bars[i] === '1') doc.rect(bx + i * moduleW, by, moduleW, barH, 'F');
      }

      doc.setFont('courier', 'normal').setFontSize(pt(10));
      doc.text(upc.code, x + w / 2, by + barH + pt(10), { align: 'center' });

      if (upc.checkMismatch) {
        // Same warning the screen shows: a stored UPC whose own check digit is
        // wrong would otherwise ship a barcode that scans as another product.
        doc.setFont(FONT, 'bold').setFontSize(pt(8)).setTextColor(204, 0, 0);
        doc.text(
          `UPC check digit mismatch - stored as ...${upc.providedCheck}`,
          x + w / 2,
          by + barH + pt(10) + pt(8) * 1.4,
          { align: 'center' }
        );
        doc.setTextColor(0);
      }
    }
  }
}

/**
 * Build the full label set for a PO.
 * Returns a jsPDF document; the caller decides whether to save or print it.
 */
export async function buildCartonLabelsPdf({ po, onProgress }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: [PAGE_W, PAGE_H], orientation: 'portrait' });

  const { plan, total } = labelPlan(po);
  if (total === 0) {
    throw new Error('This purchase order has no cartons to label.');
  }

  // Pre-flight. Every one of these used to print thousands of unusable labels
  // and report success: a missing UPC drew an empty framed box; a wrong check
  // digit printed red English error text onto the carton while silently
  // correcting the bars, so the label disagreed with the product master; and a
  // long description squeezed the symbol below the 0.8x GS1 floor, or out of
  // existence entirely, with no warning. Fail before page one instead.
  if (!shipToFor(po)) {
    throw new Error(
      `PO prefix "${po?.po_prefix ?? ''}" has no ship-to address (known prefixes: ` +
      `${KNOWN_PREFIXES.join(', ')}). This used to default to the London processing ` +
      `centre, which would send the whole shipment to the wrong country.`
    );
  }

  const missingUpc = [];
  const badCheckDigit = [];
  const missingCoo = [];
  for (const { item } of plan) {
    if (!String(item?.country_of_origin || '').trim()) {
      missingCoo.push(item?.item_number || item?.description || 'an item');
    }
    const upc = normalizeUpc(item?.upc_code);
    const label = item?.item_number || item?.description || 'an item';
    if (upc.isEmpty) missingUpc.push(label);
    else if (upc.checkMismatch) badCheckDigit.push(`${label} (${item.upc_code})`);
  }
  if (missingCoo.length) {
    throw new Error(
      `Country of origin is blank on ${missingCoo.join(', ')}. It used to default ` +
      `to USA on the carton, which is a false origin claim on a customs-facing label.`
    );
  }
  if (missingUpc.length) {
    throw new Error(
      `No UPC on ${missingUpc.join(', ')}. Add it in Products before printing — ` +
      `labels would otherwise print with a blank barcode box.`
    );
  }
  if (badCheckDigit.length) {
    throw new Error(
      `The UPC check digit is wrong on ${badCheckDigit.join(', ')}. Correct the ` +
      `product record before printing — the barcode would scan as a different code ` +
      `than the one stored.`
    );
  }

  let printed = 0;
  let first = true;
  // Box numbers restart for each line item (flavour): a PO with 12 Vanilla and
  // 8 Chocolate cartons prints "Box 1 of 12" … "Box 12 of 12", then
  // "Box 1 of 8" … "Box 8 of 8". The ITEM field and description on the same
  // label tell two "Box 1" cartons apart.
  for (const { item, cartons } of plan) {
    for (let i = 0; i < cartons; i += 1) {
      if (!first) doc.addPage([PAGE_W, PAGE_H], 'portrait');
      first = false;
      drawLabel(doc, {
        po,
        item,
        boxNumber: i + 1,
        totalBoxes: cartons,
      });
      printed += 1;
      if (onProgress && printed % 50 === 0) {
        onProgress(printed, total);
        // Yield so a long run doesn't freeze the tab.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  onProgress?.(printed, total);
  return { doc, total: printed };
}
