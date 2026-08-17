/**
 * Returns the clean PO number without the prefix.
 * Handles cases where po_number already contains the prefix (e.g. "50 813584" → "813584")
 * or just the bare number (e.g. "813584" → "813584").
 */
export function cleanPoNumber(po) {
  const num = (po.po_number || "").trim();
  const prefix = (po.po_prefix || "").trim();
  if (prefix && num.startsWith(prefix + " ")) {
    return num.slice(prefix.length + 1).trim();
  }
  return num;
}

/**
 * Returns the full formatted PO number: "prefix number"
 * e.g. "50 813584"
 */
export function formatPoNumber(po) {
  return `${po.po_prefix} ${cleanPoNumber(po)}`;
}