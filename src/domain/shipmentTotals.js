/**
 * Shipment arithmetic — one implementation, used by every document.
 *
 * WHY THIS EXISTS
 * The audit found six independent implementations of "the gross weight of this
 * shipment", and they disagreed. The packing list multiplied cartons by *net*
 * weight and printed the result in the *Gross* column; the customer invoice
 * summed a *per-carton* weight as though it were a line total; the SCLP load
 * plan computed a column labelled "Weight (kg)" from net weight into a variable
 * named totalGross. Only the commercial invoice was right.
 *
 * These were never independent bugs. They were one missing module. Customs
 * receives a packing list and a commercial invoice for the same shipment, and
 * when the two disagree about weight it is the shipper who has to explain it.
 *
 * Every quantity here is derived from a PO line item, whose weight fields are
 * PER CARTON (`gross_weight_kg`, `net_weight_kg`, `cbm`). Multiplying by
 * `num_cartons` is the whole job, and it is exactly the step that kept being
 * skipped.
 */

/** parseFloat that treats '', null, undefined and NaN alike as 0. */
export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Line-level figures. Weights on the item are per carton. */
export function lineTotals(item) {
  const cartons = num(item?.num_cartons);
  return {
    cartons,
    units: num(item?.total_units),
    grossKg: cartons * num(item?.gross_weight_kg),
    netKg: cartons * num(item?.net_weight_kg),
    cbm: cartons * num(item?.cbm),
    value: num(item?.total_units) * num(item?.unit_price),
  };
}

/** Shipment-level figures. */
export function shipmentTotals(items) {
  return (items || []).reduce(
    (acc, item) => {
      const t = lineTotals(item);
      acc.cartons += t.cartons;
      acc.units += t.units;
      acc.grossKg += t.grossKg;
      acc.netKg += t.netKg;
      acc.cbm += t.cbm;
      acc.value += t.value;
      return acc;
    },
    { cartons: 0, units: 0, grossKg: 0, netKg: 0, cbm: 0, value: 0 }
  );
}

/**
 * Net weight can never exceed gross — gross is net plus packaging. A shipment
 * that declares otherwise is physically impossible and is a standard customs
 * query. Returns the offending items so the caller can name them.
 */
export function weightAnomalies(items) {
  return (items || [])
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => {
      const g = num(item?.gross_weight_kg);
      const n = num(item?.net_weight_kg);
      return g > 0 && n > 0 && n > g;
    })
    .map(({ item, i }) => ({
      index: i,
      itemNumber: item?.item_number || `line ${i + 1}`,
      grossKg: num(item?.gross_weight_kg),
      netKg: num(item?.net_weight_kg),
    }));
}

/**
 * Customer-document line items use a different shape: `qty` is the number of
 * cartons (see CustomerDocs.jsx, which sums it as `totalCartons`), and the
 * weight fields are still PER CARTON because they are filled from the product
 * catalog's `carton_gross_weight_kg`.
 *
 * Both customer documents rendered those per-carton figures directly as line
 * totals, understating a 100-case line by 100x on a customs invoice.
 */
export function customerLineTotals(item) {
  const cartons = num(item?.qty);
  return {
    cartons,
    grossKg: cartons * num(item?.gross_weight_kg),
    netKg: cartons * num(item?.net_weight_kg),
    value: num(item?.total_amount),
  };
}

export function customerTotals(items) {
  return (items || []).reduce(
    (acc, item) => {
      const t = customerLineTotals(item);
      acc.cartons += t.cartons;
      acc.grossKg += t.grossKg;
      acc.netKg += t.netKg;
      acc.value += t.value;
      return acc;
    },
    { cartons: 0, grossKg: 0, netKg: 0, value: 0 }
  );
}
