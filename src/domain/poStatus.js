/**
 * The purchase-order lifecycle. Single source of truth.
 *
 * This list and the `bumpStatus` logic were duplicated in five files
 * (POForm, PurchaseOrders, SCLP, Invoices, emailDocs) plus a sixth copy in the
 * `purchase_order_status_chk` constraint. They happened to agree, but adding a
 * status meant six coordinated edits — miss one and a PO silently fails to
 * advance in exactly one flow.
 *
 * Note that the *authoritative* guarantee is now server-side: a trigger on
 * purchase_order refuses to move a PO backwards (migration 002). This module
 * keeps the UI honest; the trigger keeps concurrent users honest, which the
 * client-side check never could — it compares against the row the browser
 * loaded, so two users editing at once could still move a PO back.
 */
export const STATUS_ORDER = ['draft', 'ready', 'booked', 'shipped', 'invoiced'];

export const DEFAULT_STATUS = 'draft';

/**
 * Advance a PO to `target`, never backwards.
 * Unknown targets leave the status untouched.
 */
export function bumpStatus(current, target) {
  const cur = STATUS_ORDER.indexOf(current || DEFAULT_STATUS);
  const tgt = STATUS_ORDER.indexOf(target);
  if (tgt === -1) return current || DEFAULT_STATUS;
  return tgt > cur ? target : current || DEFAULT_STATUS;
}

export function statusRank(status) {
  const i = STATUS_ORDER.indexOf(status || DEFAULT_STATUS);
  return i === -1 ? 0 : i;
}

export function isAtLeast(status, target) {
  return statusRank(status) >= statusRank(target);
}
