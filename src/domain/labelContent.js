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

export const shipToFor = (po) => SHIP_TO[po?.po_prefix] || SHIP_TO['50'];

/**
 * The eight labelled cells, in the order they appear on the label.
 * One definition, so the preview and the printed carton always agree.
 */
export const labelCells = (po, item) => [
  ['PO', po?.po_number],
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
