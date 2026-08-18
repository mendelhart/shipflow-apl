/**
 * Adapter core tests.
 *
 * These import the SHIPPED module. The previous suite read base44Client.js as
 * text, regex-replaced identifiers and eval'd it — so it ran non-strict code
 * that was not what production executed, and it could not reach anything
 * touching the Supabase client.
 *
 * Every case here corresponds to a bug that silently corrupts or loses data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toTable,
  applySort,
  applyWhere,
  fetchAll,
  nullifyBlanks,
  escapeLike,
  PAGE_SIZE,
} from '../src/api/adapterCore.js';

/* ------------------------------------------------------------- fake client */

/**
 * Records what the adapter asked for. `newBuilderPerCall` matters: PostgREST
 * builders are single-use, so fetchAll must construct a fresh query per page.
 * The old test passed the same builder every time and could not catch reuse.
 */
function makeSource(rowsTotal, { tiedCreatedDate = false } = {}) {
  const calls = { orders: [], wheres: [], ranges: [], builds: 0 };

  const makeBuilder = () => {
    const b = {
      select: () => b,
      order: (f, o) => (calls.orders.push([f, o.ascending]), b),
      eq: (f, v) => (calls.wheres.push(['eq', f, v]), b),
      neq: (f, v) => (calls.wheres.push(['neq', f, v]), b),
      in: (f, v) => (calls.wheres.push(['in', f, v]), b),
      gt: (f, v) => (calls.wheres.push(['gt', f, v]), b),
      gte: (f, v) => (calls.wheres.push(['gte', f, v]), b),
      lt: (f, v) => (calls.wheres.push(['lt', f, v]), b),
      lte: (f, v) => (calls.wheres.push(['lte', f, v]), b),
      is: (f, v) => (calls.wheres.push(['is', f, v]), b),
      not: (f, o, v) => (calls.wheres.push(['not', f, o, v]), b),
      or: (expr) => (calls.wheres.push(['or', expr]), b),
      ilike: (f, v) => (calls.wheres.push(['ilike', f, v]), b),
      range: (from, to) => {
        calls.ranges.push([from, to]);
        const end = Math.min(to, rowsTotal - 1);
        const data = [];
        for (let i = from; i <= end; i++) {
          data.push({
            id: i,
            created_date: tiedCreatedDate ? '2026-01-01T00:00:00Z' : `d${i}`,
          });
        }
        return Promise.resolve({ data, error: null });
      },
    };
    return b;
  };

  return {
    calls,
    build: () => {
      calls.builds += 1;
      return makeBuilder();
    },
  };
}

/* --------------------------------------------------------------- toTable */

test('toTable maps entity names to table names', () => {
  assert.equal(toTable('PurchaseOrder'), 'purchase_order');
  assert.equal(toTable('SCLP'), 'sclp');
  assert.equal(toTable('TjxCanadaInvoiceLog'), 'tjx_canada_invoice_log');
  assert.equal(toTable('AppSettings'), 'app_settings');
});

/* ---------------------------------------------------------------- sorting */

test('sort strings map to order() direction', () => {
  const src = makeSource(0);
  applySort(src.build(), '-created_date');
  assert.deepEqual(src.calls.orders[0], ['created_date', false]);
});

test('default sort is newest-first, matching Base44', () => {
  const src = makeSource(0);
  applySort(src.build(), undefined);
  assert.deepEqual(src.calls.orders[0], ['created_date', false]);
});

test('a unique tiebreaker is always appended (offset paging needs a total order)', () => {
  // Without this, rows sharing created_date can land on two pages or on none,
  // because Postgres does not guarantee tie order across separate queries.
  const src = makeSource(0);
  applySort(src.build(), '-created_date');
  assert.deepEqual(
    src.calls.orders.at(-1),
    ['id', true],
    'expected id asc to be appended as a tiebreaker'
  );
});

test('an explicit id sort is not duplicated', () => {
  const src = makeSource(0);
  applySort(src.build(), 'id');
  assert.equal(src.calls.orders.filter(([f]) => f === 'id').length, 1);
});

/* -------------------------------------------------------------- filtering */

test('filter operators map to the right PostgREST verbs', () => {
  const src = makeSource(0);
  applyWhere(src.build(), {
    carrier_name: 'ABC',
    status: { $in: ['open', 'sent'] },
    total: { $gte: 100 },
    voided: null,
  });
  assert.deepEqual(src.calls.wheres, [
    ['eq', 'carrier_name', 'ABC'],
    ['in', 'status', ['open', 'sent']],
    ['gte', 'total', 100],
    ['is', 'voided', null],
  ]);
});

test('$ne also matches rows where the column is NULL (Mongo semantics)', () => {
  // SQL three-valued logic excludes NULLs from `neq`, so a plain .neq() would
  // silently drop every PO with no status set.
  const src = makeSource(0);
  applyWhere(src.build(), { status: { $ne: 'cancelled' } });
  const [verb, expr] = src.calls.wheres[0];
  assert.equal(verb, 'or');
  assert.match(expr, /status\.neq\.cancelled/);
  assert.match(expr, /status\.is\.null/);
});

test('$contains escapes LIKE metacharacters', () => {
  // Searching for "50%" must not match everything.
  const src = makeSource(0);
  applyWhere(src.build(), { notes: { $contains: '50%' } });
  const [, , value] = src.calls.wheres[0];
  assert.equal(value, '%50\\%%');
  assert.equal(escapeLike('a_b%c'), 'a\\_b\\%c');
});

test('a Date value is treated as a value, not as an operator object', () => {
  // typeof new Date() === 'object', so the operator branch used to iterate its
  // (empty) entries and apply NO condition at all — a filter matching every row.
  const src = makeSource(0);
  const when = new Date('2026-01-02T03:04:05Z');
  applyWhere(src.build(), { ship_date: when });
  assert.deepEqual(src.calls.wheres[0], ['eq', 'ship_date', when.toISOString()]);
});

test('unknown operators fail loudly instead of silently matching everything', () => {
  const src = makeSource(0);
  assert.throws(
    () => applyWhere(src.build(), { x: { $regex: 'a' } }),
    /Unsupported filter operator/
  );
});

/* ------------------------------------------------------------- pagination */

test('list() past the 1000-row cap returns every row exactly once', async () => {
  const src = makeSource(2350);
  const rows = await fetchAll(src.build, undefined, 'test');
  assert.equal(rows.length, 2350);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, 2350, 'no duplicate rows across pages');
});

test('a fresh query is built for every page', async () => {
  // PostgREST builders are single-use; reusing one silently returns page 1
  // repeatedly.
  const src = makeSource(2500);
  await fetchAll(src.build, undefined, 'test');
  assert.equal(src.calls.builds, 3, 'expected one build() per page');
});

test('rows sharing created_date are still returned exactly once', async () => {
  const src = makeSource(2100, { tiedCreatedDate: true });
  const rows = await fetchAll(src.build, undefined, 'test');
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  assert.equal(ids.length, 2100, 'no gaps');
});

test('explicit limits are honoured at the boundaries', async () => {
  const src = makeSource(5000);
  assert.equal((await fetchAll(src.build, 25, 't')).length, 25);
  assert.equal((await fetchAll(src.build, PAGE_SIZE, 't')).length, PAGE_SIZE);
  assert.equal((await fetchAll(src.build, PAGE_SIZE + 1, 't')).length, PAGE_SIZE + 1);
  assert.equal((await fetchAll(src.build, 1500, 't')).length, 1500);
});

test('limit 0 means zero rows, not unlimited', async () => {
  const src = makeSource(5000);
  assert.deepEqual(await fetchAll(src.build, 0, 't'), []);
  assert.equal(src.calls.ranges.length, 0, 'should not query at all');
});

test('an empty table returns [] without looping', async () => {
  const src = makeSource(0);
  assert.deepEqual(await fetchAll(src.build, undefined, 't'), []);
  assert.equal(src.calls.ranges.length, 1);
});

/* ---------------------------------------------------- blank value handling */

test('blank strings become null on write', () => {
  // Base44 accepted "" for an unset value of any type. Postgres rejects it for
  // date/numeric columns with 22007/22P02 and fails the ENTIRE row, which is
  // what made every purchase-order save fail after the migration.
  assert.deepEqual(
    nullifyBlanks({ po_number: '50123', ship_date: '', total_cbm: 0, notes: 'x' }),
    { po_number: '50123', ship_date: null, total_cbm: 0, notes: 'x' }
  );
});

test('zero and false survive blank-nulling', () => {
  const out = nullifyBlanks({ total_pallets: 0, pre_ticketed: false, seal: '' });
  assert.equal(out.total_pallets, 0, '0 must not be turned into null');
  assert.equal(out.pre_ticketed, false);
  assert.equal(out.seal, null);
});

test('arrays of records are handled (bulkCreate)', () => {
  assert.deepEqual(
    nullifyBlanks([{ a: '' }, { a: 'x' }]),
    [{ a: null }, { a: 'x' }]
  );
});
