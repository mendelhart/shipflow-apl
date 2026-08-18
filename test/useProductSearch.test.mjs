/**
 * Catalog search/sort. Pure logic, extracted from the hook so it can be tested
 * without a renderer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// Re-implementing the comparator here would defeat the point, so exercise the
// hook's pure parts through a tiny fake of React's useState/useMemo.
import Module from 'node:module';
const require = Module.createRequire(import.meta.url);

let states = [];
let idx = 0;
const react = {
  useState(init) {
    const i = idx++;
    if (states[i] === undefined) states[i] = typeof init === 'function' ? init() : init;
    return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
  },
  useMemo(fn) { return fn(); },
};
require.cache[require.resolve('react')] = { exports: react, loaded: true, id: 'react' };

const { useProductSearch } = await import('../src/hooks/useProductSearch.js');

const run = (products, mutate = () => {}) => {
  idx = 0;
  let r = useProductSearch(products);
  mutate(r);
  idx = 0;
  return useProductSearch(products);
};

const catalog = [
  { id: 'a', item_number: '1099G', description: 'Gold Pump', upc_code: '628693015998', unit_price_cad: 3.06, is_food: false },
  { id: 'b', item_number: '1002', description: 'Maple Bacon Syrup', upc_code: '628693015028', unit_price_cad: 12.5, is_food: true },
  { id: 'c', item_number: '1010', description: 'Vanilla Syrup', upc_code: '628693015103', unit_price_cad: '', is_food: true },
];

test('defaults to item_number ascending, naturally ordered', () => {
  states = [];
  const { visible } = run(catalog);
  assert.deepEqual(visible.map((p) => p.item_number), ['1002', '1010', '1099G']);
});

test('search matches item number, description and UPC', () => {
  states = [];
  let out = run(catalog, (r) => r.setSearch('bacon'));
  assert.deepEqual(out.visible.map((p) => p.id), ['b']);

  states = [];
  out = run(catalog, (r) => r.setSearch('628693015103'));
  assert.deepEqual(out.visible.map((p) => p.id), ['c']);

  states = [];
  out = run(catalog, (r) => r.setSearch('1099'));
  assert.deepEqual(out.visible.map((p) => p.id), ['a']);
});

test('food filter splits the catalog', () => {
  states = [];
  let out = run(catalog, (r) => r.setFoodFilter('non_food'));
  assert.deepEqual(out.visible.map((p) => p.id), ['a']);

  states = [];
  out = run(catalog, (r) => r.setFoodFilter('food'));
  assert.deepEqual(out.visible.map((p) => p.id).sort(), ['b', 'c']);
});

test('blank prices sort last, not as zero', () => {
  states = [];
  const out = run(catalog, (r) => r.toggleSort('unit_price_cad'));
  // ascending: 3.06, 12.5, then the blank
  assert.deepEqual(out.visible.map((p) => p.id), ['a', 'b', 'c']);
});

test('does not mutate the array it was given', () => {
  states = [];
  const original = [...catalog];
  run(catalog, (r) => r.toggleSort('description'));
  assert.deepEqual(catalog, original, 'react-query cache array must not be sorted in place');
});
