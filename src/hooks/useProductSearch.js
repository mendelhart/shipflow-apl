import { useMemo, useState } from 'react';

/**
 * Search / filter / sort for the product catalog.
 *
 * There are two product tables in this app — the standalone /Products page and
 * the catalog inside /Vendors — and only the first had search and sort, while
 * only the second is reachable from the Dashboard. So in practice the catalog
 * everyone actually uses had neither.
 *
 * One implementation, used by both, rather than a second copy that drifts.
 */

const SORTABLE = new Set([
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
const NUMERIC = new Set(['unit_price_cad', 'units_per_carton', 'carton_cbm', 'shelf_life_days']);

const SEARCH_FIELDS = ['item_number', 'description', 'upc_code', 'vendor_style', 'hs_code'];

export function useProductSearch(products, { initialSort = 'item_number' } = {}) {
  const [search, setSearch] = useState('');
  const [foodFilter, setFoodFilter] = useState('all'); // all | food | non_food
  const [sortField, setSortField] = useState(initialSort);
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (field) => {
    if (!SORTABLE.has(field)) return;
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (products || []).filter((p) => {
      if (foodFilter === 'food' && !p.is_food) return false;
      if (foodFilter === 'non_food' && p.is_food) return false;
      if (!q) return true;
      return SEARCH_FIELDS.some((f) => String(p[f] ?? '').toLowerCase().includes(q));
    });

    const field = SORTABLE.has(sortField) ? sortField : 'item_number';
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
      } else {
        av = String(av ?? '').toLowerCase();
        bv = String(bv ?? '').toLowerCase();
        // Natural ordering, so 1002 < 1010 < 1099G reads correctly and "10"
        // doesn't sort between "1" and "2".
        return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [products, search, foodFilter, sortField, sortDir]);

  return {
    search, setSearch,
    foodFilter, setFoodFilter,
    sortField, sortDir, toggleSort,
    visible,
    total: (products || []).length,
  };
}
