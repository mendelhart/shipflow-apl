import { useMemo, useState } from 'react';
import { selectProducts, nextSort, SORTABLE, DEFAULT_SORT } from '@/domain/productSearch';

/**
 * Search / filter / sort for the product catalog.
 *
 * There are two product tables in this app — the standalone /Products page and
 * the catalog inside /Vendors — and only the first had search and sort, while
 * only the second is reachable from the Dashboard. So in practice the catalog
 * everyone actually uses had neither.
 *
 * One implementation, used by both, rather than a second copy that drifts.
 * The comparison logic itself lives in @/domain/productSearch so it can be
 * tested without a renderer.
 */
export { SORTABLE };

export function useProductSearch(products, { initialSort = DEFAULT_SORT } = {}) {
  const [search, setSearch] = useState('');
  const [foodFilter, setFoodFilter] = useState('all'); // all | food | non_food
  const [sortField, setSortField] = useState(initialSort);
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (field) => {
    const next = nextSort({ sortField, sortDir }, field);
    setSortField(next.sortField);
    setSortDir(next.sortDir);
  };

  const visible = useMemo(
    () => selectProducts(products, { search, foodFilter, sortField, sortDir }),
    [products, search, foodFilter, sortField, sortDir]
  );

  return {
    search, setSearch,
    foodFilter, setFoodFilter,
    sortField, sortDir, toggleSort,
    visible,
    total: (products || []).length,
  };
}
