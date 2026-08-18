/**
 * Multi-page image pagination.
 *
 * Both PDF exports redrew the whole canvas on every page, shifted up by one
 * page. jsPDF clips to the page, not the margin box, so 2 x margin of content
 * repeated at every page break — a line item printed at the bottom of one page
 * and again at the top of the next, on a customs invoice.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { addPaginatedImage } from '../src/lib/paginatedImage.js';

/** Minimal jsPDF stand-in that records what was drawn. */
const fakePdf = (pageW, pageH, imgProps) => {
  const calls = [];
  return {
    calls,
    internal: { pageSize: { getWidth: () => pageW, getHeight: () => pageH } },
    getImageProperties: () => imgProps,
    addPage: () => calls.push({ op: 'addPage' }),
    addImage: (_d, _f, x, y, w, h) => calls.push({ op: 'addImage', x, y, w, h }),
    setFillColor: () => {},
    rect: (x, y, w, h) => calls.push({ op: 'rect', x, y, w, h }),
  };
};

test('every page masks all four margins so no band is drawn twice', () => {
  const margin = 20;
  const pdf = fakePdf(595, 842, { width: 800, height: 3000 });
  addPaginatedImage(pdf, 'data:', { margin });

  const pages = pdf.calls.filter((c) => c.op === 'addImage').length;
  const masks = pdf.calls.filter((c) => c.op === 'rect').length;
  assert.ok(pages > 1, 'this fixture must span several pages');
  assert.equal(masks, pages * 4, 'four margin masks per page');
});

test('each page advances by exactly one content height', () => {
  const margin = 20;
  const pageH = 842;
  const pdf = fakePdf(595, pageH, { width: 800, height: 3000 });
  addPaginatedImage(pdf, 'data:', { margin });

  const ys = pdf.calls.filter((c) => c.op === 'addImage').map((c) => c.y);
  const step = pageH - margin * 2;
  ys.forEach((y, i) => {
    assert.equal(y, margin - step * i, `page ${i + 1} is offset by exactly ${i} content heights`);
  });
});

test('a short image produces exactly one page', () => {
  const pdf = fakePdf(595, 842, { width: 800, height: 200 });
  addPaginatedImage(pdf, 'data:', { margin: 20 });
  assert.equal(pdf.calls.filter((c) => c.op === 'addImage').length, 1);
  assert.equal(pdf.calls.filter((c) => c.op === 'addPage').length, 0);
});
