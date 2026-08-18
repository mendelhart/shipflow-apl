/**
 * Date formatting guards.
 *
 * date-fns format() throws on an invalid date. With lazy routes, one bad row
 * blanked the whole page.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate } from '../src/lib/dates.js';

test('formats a valid ISO date', () => {
  assert.equal(formatDate('2026-08-18', 'MMM d, yyyy'), 'Aug 18, 2026');
});

test('returns the fallback instead of throwing on junk', () => {
  for (const bad of ['', null, undefined, 'not-a-date', '0000-00-00', {}, NaN]) {
    assert.equal(formatDate(bad, 'MMM d, yyyy', 'No date'), 'No date');
  }
});

test('handles a Date object', () => {
  assert.equal(formatDate(new Date('2026-01-02T00:00:00Z'), 'yyyy'), '2026');
});

test('never throws, whatever it is given', () => {
  const nasty = [Symbol.iterator ? '2026-13-45' : '', '2026-02-30T99:99:99Z', [], () => {}];
  for (const v of nasty) {
    assert.doesNotThrow(() => formatDate(v, 'MMM d, yyyy'));
  }
});
