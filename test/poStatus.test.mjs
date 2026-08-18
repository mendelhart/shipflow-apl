/**
 * Purchase-order lifecycle tests.
 *
 * This function decides whether a PO counts as booked, shipped or invoiced —
 * i.e. whether a customer gets billed. It previously existed as five separate
 * copies (POForm, PurchaseOrders, SCLP, Invoices, emailDocs) plus a sixth in a
 * SQL check constraint, with nothing keeping them in step.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  STATUS_ORDER,
  DEFAULT_STATUS,
  bumpStatus,
  statusRank,
  isAtLeast,
} from '../src/domain/poStatus.js';

test('advances forward', () => {
  assert.equal(bumpStatus('draft', 'booked'), 'booked');
  assert.equal(bumpStatus('booked', 'shipped'), 'shipped');
  assert.equal(bumpStatus('shipped', 'invoiced'), 'invoiced');
});

test('never moves backwards', () => {
  // The concrete regression: a user with a stale PO open saves an unrelated
  // edit and reverts a shipped PO to draft, erasing another user's work.
  assert.equal(bumpStatus('invoiced', 'shipped'), 'invoiced');
  assert.equal(bumpStatus('shipped', 'draft'), 'shipped');
  assert.equal(bumpStatus('booked', 'ready'), 'booked');
});

test('unknown targets leave the status untouched', () => {
  assert.equal(bumpStatus('booked', 'bogus'), 'booked');
  assert.equal(bumpStatus('booked', undefined), 'booked');
});

test('missing current status defaults to draft', () => {
  assert.equal(bumpStatus(undefined, 'booked'), 'booked');
  assert.equal(bumpStatus(null, 'ready'), 'ready');
  assert.equal(bumpStatus(null, 'bogus'), DEFAULT_STATUS);
});

test('rank and comparison helpers agree with the order', () => {
  assert.equal(statusRank('draft'), 0);
  assert.equal(statusRank('invoiced'), STATUS_ORDER.length - 1);
  assert.ok(isAtLeast('shipped', 'booked'));
  assert.ok(!isAtLeast('booked', 'shipped'));
});

test('the SQL check constraint lists exactly the same statuses', () => {
  // The database holds its own copy of this list. If the two drift, a status
  // the UI can produce becomes a write the database rejects — and the failure
  // lands on the user mid-workflow, not on whoever edited the array.
  const sql = readFileSync(
    new URL('../supabase/migrations/002_review_fixes.sql', import.meta.url),
    'utf8'
  );
  const match = sql.match(
    /array\[([^\]]*)\][\s\S]{0,40}?array_position|array_position\(\s*array\[([^\]]*)\]/
  );
  assert.ok(match, 'could not find the status array in migration 002');
  const listed = (match[1] ?? match[2])
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual(listed, STATUS_ORDER);
});
