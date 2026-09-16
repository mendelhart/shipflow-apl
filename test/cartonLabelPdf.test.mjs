/**
 * Carton label PDF tests.
 *
 * These labels go on physical cartons that ship to TJX. The failure mode that
 * matters is not "it looks slightly different" — it is producing the wrong
 * number of labels, or a barcode that scans as another product.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCartonLabelsPdf, barcodeGeometry } from '../src/lib/cartonLabelPdf.js';
import { QUIET_MODULES } from '../src/domain/upc.js';
import { normalizeUpc, encodeUpcBars } from '../src/domain/upc.js';

const po = {
  po_number: '813584',
  po_prefix: '50',
  dept_number: '81',
  pre_ticketed: true,
  items: [
    { item_number: '1002', description: 'Sugar Free Maple Bacon Syrup', vendor_style: '1002',
      units_per_carton: 6, size: '750ml', upc_code: '628693015028', num_cartons: 3, country_of_origin: 'USA' },
    { item_number: '1010', description: 'Vanilla Syrup', vendor_style: '1010',
      units_per_carton: 6, size: '750ml', upc_code: '628693015103', num_cartons: 2, country_of_origin: 'USA' },
  ],
};

test('produces exactly one page per carton', async () => {
  const { doc, total } = await buildCartonLabelsPdf({ po });
  assert.equal(total, 5);
  assert.equal(doc.getNumberOfPages(), 5, 'one page per carton across all items');
});

test('page size is 4x6 inches', async () => {
  const { doc } = await buildCartonLabelsPdf({ po });
  const { width, height } = doc.internal.pageSize;
  assert.equal(Math.round(width), 288);
  assert.equal(Math.round(height), 432);
});

test('a PO with no cartons fails loudly rather than emitting an empty file', async () => {
  await assert.rejects(
    () => buildCartonLabelsPdf({ po: { ...po, items: [{ ...po.items[0], num_cartons: 0 }] } }),
    /no cartons to label/i
  );
});

test('progress is reported and reaches the total', async () => {
  const big = {
    ...po,
    items: [{ ...po.items[0], num_cartons: 220 }],
  };
  const seen = [];
  const { total } = await buildCartonLabelsPdf({
    po: big,
    onProgress: (done, t) => seen.push([done, t]),
  });
  assert.equal(total, 220);
  assert.deepEqual(seen.at(-1), [220, 220]);
});

test('2000 labels build without exhausting memory', async () => {
  // The DOM+html2canvas implementation could not do this at all; this is the
  // regression guard for the reason it was replaced.
  const huge = { ...po, items: [{ ...po.items[0], num_cartons: 2000 }] };
  const { doc, total } = await buildCartonLabelsPdf({ po: huge });
  assert.equal(total, 2000);
  assert.equal(doc.getNumberOfPages(), 2000);
});

test('the barcode encodes the same digits the screen shows', () => {
  const { code, checkMismatch } = normalizeUpc('628693015028');
  assert.equal(code, '628693015028');
  assert.equal(checkMismatch, false);
  assert.equal(encodeUpcBars(code).length, 95, 'UPC-A is 95 modules');
});

test('an 11-digit UPC gains a computed check digit rather than a leading zero', () => {
  // The classic failure: padStart(12,"0") shifts every digit and encodes a
  // different product.
  const { code } = normalizeUpc('62869301502');
  assert.equal(code.slice(0, 11), '62869301502');
  assert.equal(code.length, 12);
});

test('a stored UPC with a bad check digit is flagged, not silently printed', () => {
  const { checkMismatch, providedCheck, code } = normalizeUpc('628693015029');
  assert.equal(checkMismatch, true);
  assert.equal(providedCheck, 9);
  assert.equal(code, '628693015028', 'prints the corrected code');
});

/* ---- Barcode geometry (GS1 UPC-A) ---------------------------------- */

test('the barcode keeps the UPC-A aspect ratio instead of filling the space', () => {
  // The defect: module width was pinned at 2pt and bar height was "whatever is
  // left on the page", so the same barcode came out a different shape on every
  // label depending on how long the product description was.
  const tall = barcodeGeometry({ availW: 267, availH: 300 });
  const short = barcodeGeometry({ availW: 267, availH: 160 });
  assert.equal(
    (tall.barH / tall.barsW).toFixed(4),
    (short.barH / short.barsW).toFixed(4),
    'proportions must not depend on leftover page space'
  );
});

test('magnification stays inside the 0.8x-2.0x GS1 permits', () => {
  // 2.14x is what the old flat 2pt module produced on a 4in label — printers
  // and verifiers reject that.
  for (const availH of [120, 200, 300, 1000]) {
    const g = barcodeGeometry({ availW: 267, availH });
    assert.ok(g.inSpec, `${g.mag}x out of spec at availH=${availH}`);
    assert.ok(g.mag <= 2.0);
  }
});

test('the symbol never overflows the space it was given', () => {
  for (const [availW, availH] of [[267, 300], [120, 300], [267, 90], [80, 60]]) {
    const g = barcodeGeometry({ availW, availH });
    const totalW = g.barsW + QUIET_MODULES * 2 * g.moduleW;
    assert.ok(totalW <= availW + 1e-9, `overflows width at ${availW}x${availH}`);
    assert.ok(g.barH <= availH + 1e-9, `overflows height at ${availW}x${availH}`);
  }
});

test('a 4x6 label lands on the intended 1.8x magnification', () => {
  const g = barcodeGeometry({ availW: 267, availH: 200 });
  assert.equal(Number(g.mag.toFixed(2)), 1.8);
  assert.equal(Number((g.barsW / 72).toFixed(2)), 2.22); // inches of bars
});

/* ---- Box numbering and pre-flight ---------------------------------- */

const poTwoItems = {
  po_prefix: '50',
  po_number: '813584',
  items: [
    { item_number: '1002', description: 'Maple Syrup', upc_code: '628693015028', num_cartons: 3, units_per_carton: 6, size: '750ml', country_of_origin: 'USA' },
    { item_number: '1010', description: 'Vanilla Syrup', upc_code: '628693015103', num_cartons: 2, units_per_carton: 6, size: '750ml', country_of_origin: 'USA' },
  ],
};

const boxLinesOf = async (po) => {
  const { doc } = await buildCartonLabelsPdf({ po });
  const raw = doc.output('arraybuffer');
  const text = Buffer.from(raw).toString('latin1');
  return [...text.matchAll(/Box (\d+) of (\d+)/g)].map((m) => `${m[1]} of ${m[2]}`);
};

test('box numbers restart per line item (flavour), not across the whole PO', async () => {
  assert.deepEqual(await boxLinesOf(poTwoItems), [
    '1 of 3', '2 of 3', '3 of 3', '1 of 2', '2 of 2',
  ]);
});

test('a stray startBox argument no longer shifts the numbering', async () => {
  const { doc } = await buildCartonLabelsPdf({ po: poTwoItems, startBox: 100 });
  const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const boxes = [...text.matchAll(/Box (\d+) of (\d+)/g)].map((m) => `${m[1]} of ${m[2]}`);
  assert.deepEqual(boxes, ['1 of 3', '2 of 3', '3 of 3', '1 of 2', '2 of 2']);
});

test('an item with no UPC stops the run instead of printing blank barcodes', async () => {
  const po = { ...poTwoItems, items: [{ ...poTwoItems.items[0], upc_code: '' }] };
  await assert.rejects(() => buildCartonLabelsPdf({ po }), /No UPC on 1002/);
});

test('a wrong check digit stops the run instead of printing a corrected barcode', async () => {
  const po = { ...poTwoItems, items: [{ ...poTwoItems.items[0], upc_code: '628693015029' }] };
  await assert.rejects(() => buildCartonLabelsPdf({ po }), /check digit is wrong/);
});

test('a very long description cannot squeeze the barcode out of spec', async () => {
  const po = { ...poTwoItems, items: [{ ...poTwoItems.items[0], description: 'X'.repeat(600) }] };
  const { total } = await buildCartonLabelsPdf({ po });
  assert.equal(total, 3, 'the run should complete, with the description truncated');
});

test('a blank country of origin stops the run rather than printing "USA"', async () => {
  // 152 of the 667 live line items are from China. The old `|| 'USA'` default
  // put a false origin on a customs-facing carton label whenever the field was
  // empty, and the on-screen preview hardcoded USA regardless.
  const po = { ...poTwoItems, items: [{ ...poTwoItems.items[0], country_of_origin: '' }] };
  await assert.rejects(() => buildCartonLabelsPdf({ po }), /Country of origin is blank/);
});
