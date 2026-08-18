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
import { FROM_ADDRESS, shipToFor, labelCells, labelPlan } from '@/domain/labelContent';

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
  const descLines = doc.splitTextToSize(String(item?.description ?? ''), w - INNER * 2 - BORDER * 2);
  const descLH = pt(14) * 1.2;
  const descH = descLines.length * descLH + INNER * 2;
  box(doc, x, y, w, descH);
  centredLines(doc, descLines, x, w, y + INNER, descLH);
  y += descH + GAP;

  /* ---- Barcode fills the remainder ---- */
  const barcodeH = PAGE_H - PAD - y;
  if (barcodeH > 20) {
    box(doc, x, y, w, barcodeH);
    const upc = normalizeUpc(item?.upc_code);
    if (!upc.isEmpty) {
      const bars = encodeUpcBars(upc.code);
      // Fit the bars, plus a quiet zone each side, to the available width.
      const modules = bars.length + QUIET_MODULES * 2;
      const moduleW = Math.min((w - INNER * 4) / modules, 2);
      const barsW = bars.length * moduleW;
      const digitsH = pt(10) * 1.4;
      const warnH = upc.checkMismatch ? pt(8) * 1.4 : 0;
      const barH = Math.max(12, barcodeH - INNER * 2 - digitsH - warnH);
      const bx = x + (w - barsW) / 2;
      const by = y + INNER;

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
export async function buildCartonLabelsPdf({ po, startBox = 1, onProgress }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: [PAGE_W, PAGE_H], orientation: 'portrait' });

  const { plan, total } = labelPlan(po, startBox);
  if (total === 0) {
    throw new Error('This purchase order has no cartons to label.');
  }

  let printed = 0;
  let first = true;
  for (const { item, cartons } of plan) {
    for (let i = 0; i < cartons; i += 1) {
      if (!first) doc.addPage([PAGE_W, PAGE_H], 'portrait');
      first = false;
      drawLabel(doc, {
        po,
        item,
        boxNumber: i + startBox,
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
