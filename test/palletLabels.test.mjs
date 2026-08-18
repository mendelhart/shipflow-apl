/**
 * Pallet labels are printed after every carton is stickered and BEFORE a
 * container is assigned. Anything only known once the container is booked and
 * sealed cannot appear on them — the label used to carry four such fields, so
 * every pallet in the warehouse read "CONTAINER —" and "SEAL —".
 */
import assert from 'node:assert/strict';
import test from 'node:test';

let html = '';
let alerted = '';
globalThis.window = { open: () => ({ document: { write: (h) => { html = h; }, close() {} } }) };
globalThis.alert = (m) => { alerted = m; };

const { openPalletLabelsWindow } = await import('../src/utils/palletLabels.js');

const po = {
  id: 'p1', po_prefix: '50', po_number: '813584', dept_number: '77', vendor_id: 'v1',
  total_pallets: 6,
  items: [
    { num_cartons: 1200, total_units: 7200, gross_weight_kg: 5.1, net_weight_kg: 5.0, cbm: 0.015 },
    { num_cartons: 928, total_units: 5568, gross_weight_kg: 4, net_weight_kg: 3.5, cbm: 0.01 },
  ],
};
const vendors = [{ id: 'v1', company_name: 'Capital Nutrition <Inc>', address_line1: '1020 Boul. Michèle-Bohec', city: 'Blainville', country: 'Canada' }];

const render = (overrides = {}, count = (p) => p.total_pallets) => {
  html = ''; alerted = '';
  openPalletLabelsWindow({ selectedPOObjects: [{ ...po, ...overrides }], vendors, getPalletCount: count });
  return html;
};

test('carries nothing that depends on the container', () => {
  const out = render();
  for (const word of ['CONTAINER', 'SEAL', 'APLL', 'BOOKING']) {
    assert.ok(!new RegExp(word, 'i').test(out), `"${word}" is not known when pallet labels are made`);
  }
});

test('pallet numbers count within the PO, not across a container load', () => {
  // Was 1..N across every PO selected on the SCLP screen, which presupposes
  // knowing what ships together — the decision that has not been made yet.
  const nums = [...render().matchAll(/PALLET (\d+) of (\d+)/g)].map((m) => `${m[1]}/${m[2]}`);
  assert.deepEqual(nums, ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
});

test('shows the PO with its prefix, matching every other document', () => {
  assert.match(render(), /po-val">50 813584</);
});

test('totals come from the shared calculation', () => {
  const out = render();
  assert.match(out, /TOTAL CARTONS<\/div>\s*<div class="val bold">2128</);
  assert.match(out, /GROSS WEIGHT<\/div>\s*<div class="val">9832\.00 kg</);
});

test('vendor text is escaped, not written raw into the popup', () => {
  assert.ok(render().includes('Capital Nutrition &lt;Inc&gt;'));
  assert.ok(!render().includes('<Inc>'));
});

test('an unknown PO prefix refuses rather than addressing the pallet to London', () => {
  const out = render({ po_prefix: '' });
  assert.equal(out, '');
  assert.match(alerted, /No ship-to address/);
});
