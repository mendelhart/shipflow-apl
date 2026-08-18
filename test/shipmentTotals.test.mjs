/**
 * Shipment arithmetic. Six separate implementations of "gross weight" had
 * drifted apart far enough that the packing list and the commercial invoice
 * for one shipment declared different numbers to customs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lineTotals,
  shipmentTotals,
  customerLineTotals,
  customerTotals,
  weightAnomalies,
} from '../src/domain/shipmentTotals.js';

const items = [
  { num_cartons: 1000, total_units: 6000, gross_weight_kg: 5.1, net_weight_kg: 5.0, cbm: 0.015, unit_price: 2 },
  { num_cartons: 100, total_units: 600, gross_weight_kg: 4, net_weight_kg: 3.5, cbm: 0.01, unit_price: 1.5 },
];

test('weights are per carton and must be multiplied out', () => {
  const t = lineTotals(items[0]);
  assert.equal(t.grossKg, 5100);
  assert.equal(t.netKg, 5000);
  assert.equal(t.cbm, 15);
});

test('gross is never below net for the same input', () => {
  // The concrete regression: PackingListDoc fed net into the Gross column and
  // vice versa, so its two totals came out inverted against the invoice's.
  const t = shipmentTotals(items);
  assert.equal(t.grossKg, 5500);
  assert.equal(t.netKg, 5350);
  assert.ok(t.grossKg > t.netKg, 'gross is net plus packaging');
});

test('blank, null and non-numeric quantities count as zero, not NaN', () => {
  const t = shipmentTotals([{ num_cartons: '', gross_weight_kg: null, net_weight_kg: 'abc', cbm: undefined }]);
  assert.deepEqual(t, { cartons: 0, units: 0, grossKg: 0, netKg: 0, cbm: 0, value: 0 });
});

test('customer documents multiply per-carton weights by the case count', () => {
  // CustomerInvoiceDoc printed the catalog's per-carton weight as the line
  // total, understating a 100-case line by 100x on a customs invoice.
  const t = customerLineTotals({ qty: 100, gross_weight_kg: 5, net_weight_kg: 4.5 });
  assert.equal(t.grossKg, 500);
  assert.equal(t.netKg, 450);
  assert.equal(customerTotals([{ qty: 100, gross_weight_kg: 5 }]).grossKg, 500);
});

test('net heavier than gross is reported, not silently reordered', () => {
  // CustomerPackingListDoc used min/max, which hid bad data by printing the two
  // the "right" way round — so the packing list and invoice disagreed instead.
  const bad = weightAnomalies([{ item_number: '1002', gross_weight_kg: 5.0, net_weight_kg: 5.1 }]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].itemNumber, '1002');
});

test('a missing weight is not treated as an anomaly', () => {
  assert.deepEqual(weightAnomalies([{ item_number: 'x', gross_weight_kg: 0, net_weight_kg: 5 }]), []);
  assert.deepEqual(weightAnomalies([{ item_number: 'x' }]), []);
});
