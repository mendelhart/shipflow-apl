/**
 * Catalog search / filter / sort — pure, no React.
 *
 * This lives apart from the hook so it can be tested by importing it, rather
 * than by faking React. The previous test stubbed `react` through Node's
 * CommonJS require cache; that worked on Node 22 and threw ERR_INVALID_ARG_TYPE
 * on Node 20, so CI failed on a harness quirk while the code was fine. Logic
 * that needs a fake module system to be testable is logic in the wrong place.
 */

export const SORTABLE = new Set([
  'item_number',
  'description',
  'upc_code',
  'hs_code',
  'country_of_origin',
  'unit_price_cad',
  'size',
  'units_per_carton',
]);

/** Columns compared as numbers rather than strings. */
export const NUMERIC = new Set(['unit_price_cad', 'units_per_carton', 'carton_cbm', 'shelf_life_days']);

export const SEARCH_FIELDS = ['item_number', 'description', 'upc_code', 'vendor_style', 'hs_code'];

export const DEFAULT_SORT = 'item_number';

/**
 * @param {object[]} products
 * @param {{search?: string, foodFilter?: 'all'|'food'|'non_food', sortField?: string, sortDir?: 'asc'|'desc'}} opts
 * @returns {object[]} a new array; the input is never mutated
 */
export function selectProducts(products, { search = '', foodFilter = 'all', sortField = DEFAULT_SORT, sortDir = 'asc' } = {}) {
  const q = String(search || '').trim().toLowerCase();

  const rows = (products || []).filter((p) => {
    if (foodFilter === 'food' && !p.is_food) return false;
    if (foodFilter === 'non_food' && p.is_food) return false;
    if (!q) return true;
    return SEARCH_FIELDS.some((f) => String(p[f] ?? '').toLowerCase().includes(q));
  });

  const field = SORTABLE.has(sortField) ? sortField : DEFAULT_SORT;
  const dir = sortDir === 'asc' ? 1 : -1;

  // Sort a copy: Array.prototype.sort mutates, and `products` is react-query's
  // cached array — sorting it in place mutates the cache other pages read.
  return [...rows].sort((a, b) => {
    let av = a[field];
    let bv = b[field];
    if (NUMERIC.has(field)) {
      av = parseFloat(av);
      bv = parseFloat(bv);
      // Blanks sort last in both directions rather than pretending to be 0.
      const aEmpty = !Number.isFinite(av);
      const bEmpty = !Number.isFinite(bv);
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    }
    av = String(av ?? '').toLowerCase();
    bv = String(bv ?? '').toLowerCase();
    // Natural ordering, so 1002 < 1010 < 1099G reads correctly and "10"
    // doesn't sort between "1" and "2".
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

/** Which direction a column should take when its header is clicked. */
export function nextSort(current, field) {
  if (!SORTABLE.has(field)) return current;
  if (current.sortField === field) {
    return { sortField: field, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' };
  }
  return { sortField: field, sortDir: 'asc' };
}
