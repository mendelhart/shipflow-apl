/**
 * Carton-label content. Shared by the on-screen preview and the PDF/print
 * builder so the two cannot drift.
 */

export const SHIP_TO = {
  '50': 'TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW',
  '55': 'TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany',
};

export const FROM_ADDRESS =
  'Capital Nutrition Inc.\n1020 Boul. Michèle-Bohec\nBlainville, QC, J7C 5E2\nCanada';

/**
 * Ship-to for a PO prefix. Returns undefined for an unrecognised prefix rather
 * than defaulting — a blank or future prefix used to silently address every
 * carton to the London processing centre. Callers check and refuse to print.
 */
export const shipToFor = (po) => SHIP_TO[po?.po_prefix];

/** Human-readable list of the prefixes we can actually ship to. */
export const KNOWN_PREFIXES = Object.keys(SHIP_TO);

/** The PO number as it should appear on a label: prefix and number together. */
export const labelPoNumber = (po) =>
  po?.po_prefix ? `${po.po_prefix} ${po.po_number ?? ''}`.trim() : String(po?.po_number ?? '');

/**
 * The eight labelled cells, in the order they appear on the label.
 * One definition, so the preview and the printed carton always agree.
 */
export const labelCells = (po, item) => [
  // formatPoNumber elsewhere prints "50 813584"; this printed the bare number,
  // so an AI-imported PO said "813584" on the carton and "50 813584" on its
  // invoice and packing list.
  ['PO', labelPoNumber(po)],
  ['DEPT', po?.dept_number],
  ['ITEM', item?.item_number],
  ['STYLE', item?.vendor_style],
  ['QTY', item?.units_per_carton],
  // Blank rather than a silent 'USA': the carton is a customs-facing document
  // too, and buildCartonLabelsPdf refuses to print when this is empty.
  ['COO', item?.country_of_origin || ''],
  ['SIZE', item?.size],
  ['TICKET', po?.pre_ticketed ? 'Yes' : 'No'],
];

/** Total cartons to label for a PO, and how many labels that is in all. */
export function labelPlan(po, startBox = 1) {
  const items = po?.items || [];
  const plan = [];
  let total = 0;
  items.forEach((item) => {
    const cartons = parseInt(item.num_cartons, 10) || 0;
    if (cartons > 0) plan.push({ item, cartons });
    total += cartons;
  });
  return { plan, total, startBox };
}
