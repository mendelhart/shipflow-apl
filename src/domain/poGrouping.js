/**
 * How purchase orders are bucketed into months.
 *
 * Every screen grouped by `created_date` — the day the PO was typed into this
 * app. That is an artefact of data entry, not a fact about the shipment: a PO
 * entered in March for an August sailing filed itself under March, so the
 * months on screen never lined up with the months anyone actually works to.
 *
 * Grouping is by `ship_date` instead. POs with no ship date yet are not
 * "unknown" — they are the ones still to be scheduled, which is the most
 * actionable bucket, so they sort first rather than being dumped at the bottom.
 */
import { format } from 'date-fns';

export const UNSCHEDULED = 'Not yet scheduled';

const parse = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The month bucket a PO belongs to. */
export function poGroupKey(po) {
  const d = parse(po?.ship_date);
  if (!d) return UNSCHEDULED;
  try {
    return format(d, 'MMMM yyyy');
  } catch {
    return UNSCHEDULED;
  }
}

/**
 * Sort weight for a bucket. Unscheduled first, then most recent month first.
 * Sorting on a number rather than `new Date("May 2026")`, which only parses by
 * accident and differs between engines.
 */
export function groupSortValue(key, posInGroup = []) {
  if (key === UNSCHEDULED) return Infinity;
  const first = posInGroup.find((p) => parse(p?.ship_date));
  const d = first ? parse(first.ship_date) : null;
  return d ? d.getFullYear() * 12 + d.getMonth() : -Infinity;
}

/** Group a list of POs into { key, pos }[], already ordered for display. */
export function groupPosByShipMonth(pos = []) {
  const groups = new Map();
  for (const po of pos) {
    const key = poGroupKey(po);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(po);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, pos: list, sort: groupSortValue(key, list) }))
    .sort((a, b) => b.sort - a.sort);
}
