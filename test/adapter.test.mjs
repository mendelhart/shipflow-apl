/**
 * Adapter behaviour tests against a fake Supabase client.
 * Verifies the three things most likely to silently corrupt data:
 *   1. list() past 1000 rows must paginate, not truncate.
 *   2. sort strings must map to the right order/direction.
 *   3. filter operators must map to the right PostgREST calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// --- fake query builder that records what the adapter asked for ------------
function fakeFrom(rowsTotal) {
  const calls = { orders: [], wheres: [], ranges: [] };
  const builder = {
    select: () => builder,
    order: (f, o) => (calls.orders.push([f, o.ascending]), builder),
    eq: (f, v) => (calls.wheres.push(['eq', f, v]), builder),
    neq: (f, v) => (calls.wheres.push(['neq', f, v]), builder),
    in: (f, v) => (calls.wheres.push(['in', f, v]), builder),
    gt: (f, v) => (calls.wheres.push(['gt', f, v]), builder),
    gte: (f, v) => (calls.wheres.push(['gte', f, v]), builder),
    lt: (f, v) => (calls.wheres.push(['lt', f, v]), builder),
    lte: (f, v) => (calls.wheres.push(['lte', f, v]), builder),
    is: (f, v) => (calls.wheres.push(['is', f, v]), builder),
    not: (f, o, v) => (calls.wheres.push(['not', f, o, v]), builder),
    ilike: (f, v) => (calls.wheres.push(['ilike', f, v]), builder),
    range: (from, to) => {
      calls.ranges.push([from, to]);
      const end = Math.min(to, rowsTotal - 1);
      const data = [];
      for (let i = from; i <= end; i++) data.push({ id: i });
      return Promise.resolve({ data, error: null });
    },
  };
  return { builder, calls };
}

// Re-implement the module under test with the fake injected. The adapter's
// logic lives in pure helpers, so we exercise them exactly as shipped.
const src = await import('node:fs').then(fs =>
  fs.promises.readFile(new URL('../src/api/base44Client.js', import.meta.url), 'utf8'));

// Extract the helpers without executing the Supabase bootstrap.
// Strip the module bootstrap (Supabase client construction, env access) and
// keep the pure helpers. Cutting on the section banner is stable against
// changes inside the bootstrap block.
const UTILS_BANNER = '/* ------------------------------------------------------------------ utils */';
const body = src
  .slice(src.indexOf(UTILS_BANNER))
  .replace(/import\.meta\.env\.\w+/g, 'undefined')
  .replace(/^export \{[^}]*\};?$/m, '')
  .replace(/^export default base44;$/m, '')
  .replace(/\bsupabase\b/g, 'undefined')
  .replace(/export /g, '');

const mod = new Function(`${body}; return { applySort, applyWhere, fetchAll, toTable, PAGE_SIZE };`)();

test('toTable maps PascalCase entities to snake_case tables', () => {
  assert.equal(mod.toTable('PurchaseOrder'), 'purchase_order');
  assert.equal(mod.toTable('SCLP'), 'sclp');
  assert.equal(mod.toTable('TjxCanadaInvoiceLog'), 'tjx_canada_invoice_log');
});

test('sort strings map to order() direction', () => {
  const { builder, calls } = fakeFrom(0);
  mod.applySort(builder, '-created_date');
  mod.applySort(builder, 'carrier_name');
  assert.deepEqual(calls.orders, [['created_date', false], ['carrier_name', true]]);
});

test('default sort is newest-first, matching Base44', () => {
  const { builder, calls } = fakeFrom(0);
  mod.applySort(builder, undefined);
  assert.deepEqual(calls.orders, [['created_date', false]]);
});

test('filter operators map to PostgREST verbs', () => {
  const { builder, calls } = fakeFrom(0);
  mod.applyWhere(builder, {
    carrier_name: 'ABC',
    status: { $in: ['open', 'sent'] },
    total: { $gte: 100 },
    note: { $contains: 'urgent' },
    voided: null,
  });
  assert.deepEqual(calls.wheres, [
    ['eq', 'carrier_name', 'ABC'],
    ['in', 'status', ['open', 'sent']],
    ['gte', 'total', 100],
    ['ilike', 'note', '%urgent%'],
    ['is', 'voided', null],
  ]);
});

test('unknown operators fail loudly instead of silently matching everything', () => {
  const { builder } = fakeFrom(0);
  assert.throws(() => mod.applyWhere(builder, { x: { $regex: 'a' } }), /Unsupported filter operator/);
});

test('list() past the 1000-row cap returns every row', async () => {
  const { builder } = fakeFrom(2350);
  const rows = await mod.fetchAll(() => builder, undefined, 'test');
  assert.equal(rows.length, 2350, 'must paginate past Supabase 1000-row cap');
});

test('list() with an explicit limit returns exactly that many', async () => {
  const { builder } = fakeFrom(5000);
  assert.equal((await mod.fetchAll(() => builder, 25, 'test')).length, 25);
  assert.equal((await mod.fetchAll(() => builder, 1500, 'test')).length, 1500);
});

test('empty table returns [] rather than looping', async () => {
  const { builder, calls } = fakeFrom(0);
  assert.deepEqual(await mod.fetchAll(() => builder, undefined, 'test'), []);
  assert.equal(calls.ranges.length, 1);
});
