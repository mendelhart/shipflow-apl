/**
 * PO month grouping. Screens grouped by created_date — the day someone typed
 * the PO in — so a PO entered in March for an August sailing appeared under
 * March, and the months on screen never matched the months people work to.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { groupPosByShipMonth, poGroupKey, UNSCHEDULED } from '../src/domain/poGrouping.js';

const po = (id, ship, created) => ({ id, ship_date: ship, created_date: created });

test('a PO is filed under the month it ships, not the month it was entered', () => {
  assert.equal(poGroupKey(po('a', '2026-08-31', '2026-03-02')), 'August 2026');
});

test('POs with no ship date are "not yet scheduled" and sort first', () => {
  const groups = groupPosByShipMonth([
    po('a', '2026-06-15'),
    po('b', null, '2026-03-02'),
    po('c', '2026-08-31'),
  ]);
  assert.deepEqual(groups.map((g) => g.key), [UNSCHEDULED, 'August 2026', 'June 2026']);
});

test('months run newest first', () => {
  const groups = groupPosByShipMonth([
    po('a', '2026-04-01'), po('b', '2026-08-01'), po('c', '2026-06-01'),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['August 2026', 'June 2026', 'April 2026']);
});

test('POs shipping in the same month land in one bucket', () => {
  const groups = groupPosByShipMonth([po('a', '2026-08-03'), po('b', '2026-08-28')]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].pos.map((p) => p.id), ['a', 'b']);
});

test('an unparseable ship date is treated as unscheduled, not as a crash', () => {
  assert.equal(poGroupKey(po('a', 'not a date')), UNSCHEDULED);
  assert.equal(poGroupKey({}), UNSCHEDULED);
});
