/**
 * Catalog search/sort. Pure logic, imported directly — no React, no fake
 * module system. The previous version of this file stubbed `react` via Node's
 * CommonJS require cache, which passed on Node 22 and threw
 * ERR_INVALID_ARG_TYPE on the Node 20 that CI runs. The test was testing the
 * harness as much as the code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { selectProducts, nextSort } from '../src/domain/productSearch.js';

const catalog = [
  { id: 'a', item_number: '1099G', description: 'Gold Pump', upc_code: '628693015998', unit_price_cad: 3.06, is_food: false },
  { id: 'b', item_number: '1002', description: 'Maple Bacon Syrup', upc_code: '628693015028', unit_price_cad: 12.5, is_food: true },
  { id: 'c', item_number: '1010', description: 'Vanilla Syrup', upc_code: '628693015103', unit_price_cad: '', is_food: true },
];

const ids = (rows) => rows.map((p) => p.id);

test('defaults to item_number ascending, naturally ordered', () => {
  // '1099G' must not sort between '1002' and '1010' the way plain string
  // comparison would put it.
  assert.deepEqual(selectProducts(catalog).map((p) => p.item_number), ['1002', '1010', '1099G']);
});

test('search matches item number, description and UPC', () => {
  assert.deepEqual(ids(selectProducts(catalog, { search: 'bacon' })), ['b']);
  assert.deepEqual(ids(selectProducts(catalog, { search: '628693015103' })), ['c']);
  assert.deepEqual(ids(selectProducts(catalog, { search: '1099' })), ['a']);
});

test('search ignores case and surrounding whitespace', () => {
  assert.deepEqual(ids(selectProducts(catalog, { search: '  MAPLE  ' })), ['b']);
});

test('food filter splits the catalog', () => {
  assert.deepEqual(ids(selectProducts(catalog, { foodFilter: 'food' })), ['b', 'c']);
  assert.deepEqual(ids(selectProducts(catalog, { foodFilter: 'non_food' })), ['a']);
  assert.equal(selectProducts(catalog, { foodFilter: 'all' }).length, 3);
});

test('blank prices sort last, not as zero', () => {
  // Product 'c' has unit_price_cad: ''. parseFloat('') is NaN; treating that as
  // 0 would file the most expensive-looking gap at the cheap end.
  assert.deepEqual(ids(selectProducts(catalog, { sortField: 'unit_price_cad', sortDir: 'asc' })), ['a', 'b', 'c']);
  assert.deepEqual(ids(selectProducts(catalog, { sortField: 'unit_price_cad', sortDir: 'desc' })), ['b', 'a', 'c']);
});

test('does not mutate the array it was given', () => {
  const original = [...catalog];
  selectProducts(catalog, { sortField: 'unit_price_cad', sortDir: 'desc' });
  assert.deepEqual(catalog, original, 'react-query caches this array; other pages read it');
});

test('an unknown sort field falls back to item_number', () => {
  assert.deepEqual(
    selectProducts(catalog, { sortField: 'not_a_column' }).map((p) => p.item_number),
    ['1002', '1010', '1099G']
  );
});

test('clicking the same column flips direction; a new column starts ascending', () => {
  assert.deepEqual(nextSort({ sortField: 'item_number', sortDir: 'asc' }, 'item_number'), { sortField: 'item_number', sortDir: 'desc' });
  assert.deepEqual(nextSort({ sortField: 'item_number', sortDir: 'desc' }, 'description'), { sortField: 'description', sortDir: 'asc' });
});

test('unsortable columns are ignored rather than clearing the sort', () => {
  const current = { sortField: 'item_number', sortDir: 'desc' };
  assert.deepEqual(nextSort(current, 'is_food'), current);
});
