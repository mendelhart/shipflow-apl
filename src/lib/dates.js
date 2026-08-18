import { format, parseISO, isValid } from 'date-fns';

/**
 * Safe date formatting.
 *
 * date-fns `format()` THROWS a RangeError on an invalid date, and `parseISO`
 * returns Invalid Date for anything it cannot read. With every page lazy-loaded
 * and (until recently) no error boundary, one malformed date in one row blanked
 * the entire screen.
 *
 * Malformed dates are not hypothetical here: the data came from a document
 * store that accepted "" and any string shape for a date field.
 */
export function formatDate(value, pattern, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const d = typeof value === 'string' ? parseISO(value) : new Date(value);
    if (!isValid(d)) return fallback;
    return format(d, pattern);
  } catch {
    return fallback;
  }
}

/** Same, for a value that should be treated as a plain Date. */
export function formatDateTime(value, pattern = 'MMM d, yyyy h:mm a', fallback = '—') {
  return formatDate(value, pattern, fallback);
}
