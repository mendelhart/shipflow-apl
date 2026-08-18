import { format } from "date-fns";
import { formatPoNumber } from "@/utils/poNumber";
 
/**
 * SCLPDoc
 *
 * Props:
 *  poList         - array of PO objects (required)
 *  vendor         - primary vendor (for single-vendor loads)
 *  vendors        - full vendor list (for multi-vendor lookups)
 *  shipmentInfo   - { loadType, containerSize, containerNumber, sealNumber,
 *                     apllBookingNumber, vesselName, voyageNumber,
 *                     portOfLoading, actualDeliveryDate }
 *  itemOverrides  - if provided, overrides items for all POs (used in split mode)
 *  containerLabel - optional red sub-title
 *  palletOverrides - { [poId]: number } - user-edited pallet counts
 *  combinedTable  - if true, merge all PO items into one table with grand totals
 */
export default function SCLPDoc({
  poList = [],
  vendor,
  vendors = [],
  shipmentInfo = {},
  itemOverrides,
  containerLabel,
  palletOverrides = {},
  palletCount,
  combinedTable = true,
}) {
  const s = (val, fallback = "—") => val || fallback;
 
  const cell = (content, extra = {}) => (
    <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "11px", ...extra }}>
      {content}
    </td>
  );
 
  const th = (content, extra = {}) => (
    <th style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "11px", background: "#eee", fontWeight: "bold", ...extra }}>
      {content}
    </th>
  );
 
  // Resolve vendor for a PO
  const getVendor = (po) => vendor || vendors.find(v => v.id === po.vendor_id);
 
  // Primary vendor info (for header)
  const primaryPO = poList[0];
  const primaryVendor = getVendor(primaryPO || {});
  const vendorPhone = primaryVendor?.phone || "";
  const vendorFax = primaryVendor?.fax || "";
  const vendorEmail = primaryVendor?.email || "";
  const vendorAddr = primaryVendor
    ? [primaryVendor.address_line1, primaryVendor.city, primaryVendor.state_province, primaryVendor.postal_code]
        .filter(Boolean).join(", ")
    : "";
 
  // Build rows: if combinedTable, flatten all POs; otherwise per-PO
  const buildRows = () => {
    if (itemOverrides) {
      return itemOverrides.map((item, i) => ({
        po: item.po || primaryPO,
        item,
        key: `override-${i}`,
      }));
    }
    if (combinedTable) {
      return poList.flatMap(po =>
        (po.items || []).map((item, i) => ({ po, item, key: `${po.id}-${i}` }))
      );
    }
    // single PO
    return (poList[0]?.items || []).map((item, i) => ({
      po: poList[0],
      item,
      key: `item-${i}`,
    }));
  };
 
  const rows = buildRows();
 
  // Aggregate totals
  const totalCartons = rows.reduce((s, r) => s + (parseInt(r.item.num_cartons) || 0), 0);
  const totalUnits   = rows.reduce((s, r) => s + (parseFloat(r.item.total_units) || 0), 0);
  // A container load plan is checked against container and axle weight limits,
  // so it needs GROSS. This summed net into a variable named totalGross,
  // understating the load by the packaging weight on every line.
  const totalGross   = rows.reduce((s, r) => {
    const c = parseInt(r.item.num_cartons) || 0;
    return s + c * (parseFloat(r.item.gross_weight_kg) || 0);
  }, 0);
  const totalCbm     = rows.reduce((s, r) => {
    const c = parseInt(r.item.num_cartons) || 0;
    return s + c * (parseFloat(r.item.cbm) || 0);
  }, 0);
 
  // Total pallets: sum overrides or stored values
  const totalPallets = (palletCount !== undefined && palletCount !== "")
    ? (parseInt(palletCount) || 0)
    : poList.reduce((sum, po) => {
        const override = palletOverrides[po.id];
        const stored   = po.total_pallets;
        const val = override !== undefined && override !== "" ? parseInt(override) : (parseInt(stored) || 0);
        return sum + val;
      }, 0);
 
  const deliveryDateFormatted = shipmentInfo.actualDeliveryDate
    ? (() => { try { return format(new Date(shipmentInfo.actualDeliveryDate), "MMM dd, yyyy"); } catch { return shipmentInfo.actualDeliveryDate; } })()
    : "—";
 
  return (
    <div style={{ fontFamily: "Arial", fontSize: "11px", padding: "15px", background: "#fff", maxWidth: "900px" }}>
 
      {/* TITLE */}
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <div style={{ fontSize: "18px", fontWeight: "bold" }}>
          Security Container Load Plan (SCLP)
        </div>
        {containerLabel && (
          <div style={{ fontSize: "12px", color: "#c00", fontWeight: "bold", marginTop: "2px" }}>
            {containerLabel}
          </div>
        )}
        {poList.length > 0 && (
          <div style={{ fontSize: "11px", color: "#555", marginTop: "3px" }}>
            PO(s): {poList.map(p => formatPoNumber(p)).join(" | ")}
          </div>
        )}
      </div>
 
      {/* STEP 1 — SHIPPER INFO */}
      <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
        STEP #1 SHIPPER'S REQUEST FOR FACTORY LOAD CONTAINER(S):
      </div>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Shipper:</strong> {s(primaryVendor?.company_name)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Phone:</strong> {s(vendorPhone)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Agent:</strong> Morris Hart
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Address:</strong> {s(vendorAddr)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Fax:</strong> {s(vendorFax)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Email:</strong> {s(vendorEmail)}
            </td>
          </tr>
        </tbody>
      </table>
 
      {/* STEP 2 — SHIPMENT DETAILS */}
      <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
        STEP #2 SHIPMENT DETAILS:
      </div>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px", width: "50%" }}>
              <strong>Load Type:</strong> {s(shipmentInfo.loadType)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Container Size:</strong> {s(shipmentInfo.containerSize)}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Container #:</strong> {s(shipmentInfo.containerNumber)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Seal #:</strong> {s(shipmentInfo.sealNumber)}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>APLL Booking #:</strong> {s(shipmentInfo.apllBookingNumber)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Port of Loading:</strong> {s(shipmentInfo.portOfLoading)}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Vessel Name:</strong> {s(shipmentInfo.vesselName)}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px" }}>
              <strong>Voyage #:</strong> {s(shipmentInfo.voyageNumber)}
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px" }} colSpan={2}>
              <strong>Actual Delivery Date to Port:</strong> {deliveryDateFormatted}
            </td>
          </tr>
        </tbody>
      </table>
 
      {/* STEP 3 — ITEMS TABLE */}
      <div style={{ fontWeight: "bold", marginBottom: "6px" }}>
        STEP #3 RECORD ORDERS AS LOADED:
      </div>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <thead>
          <tr style={{ background: "#eee" }}>
            {th("PO")}
            {th("Style")}
            {th("Description")}
            {th("Cartons", { textAlign: "center" })}
            {th("Units", { textAlign: "center" })}
            {th("CBM", { textAlign: "center" })}
            {th("Gross Weight (kg)", { textAlign: "center" })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ po, item, key }) => {
            const cartons = parseInt(item.num_cartons) || 0;
            const cbm     = cartons * (parseFloat(item.cbm) || 0);
            const weight  = cartons * (parseFloat(item.gross_weight_kg) || 0);
            return (
              <tr key={key}>
                {cell(formatPoNumber(po))}
                {cell(item.item_number)}
                {cell(`Slim Syrups ${item.description}`)}
                {cell(cartons, { textAlign: "center" })}
                {cell(item.total_units, { textAlign: "center" })}
                {cell(cbm.toFixed(2), { textAlign: "center" })}
                {cell(Math.round(weight), { textAlign: "center" })}
              </tr>
            );
          })}
 
          {/* TOTALS ROW */}
          <tr style={{ fontWeight: "bold", background: "#f5f5f5" }}>
            <td colSpan={3} style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "11px", textAlign: "right" }}>
              TOTAL
            </td>
            {cell(totalCartons, { textAlign: "center", fontWeight: "bold" })}
            {cell(totalUnits, { textAlign: "center", fontWeight: "bold" })}
            {cell(totalCbm.toFixed(2), { textAlign: "center", fontWeight: "bold" })}
            {cell(Math.round(totalGross), { textAlign: "center", fontWeight: "bold" })}
          </tr>
        </tbody>
      </table>
 
      {/* PALLETS SUMMARY */}
      {totalPallets > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ border: "1px solid #000", padding: "4px 8px", fontWeight: "bold", fontSize: "11px" }}>
                  Total Pallets:
                </td>
                <td style={{ border: "1px solid #000", padding: "4px 12px", fontSize: "11px" }}>
                  {totalPallets}
                </td>
                {poList.length > 1 && palletCount === undefined && (
                  <td style={{ border: "1px solid #000", padding: "4px 8px", fontSize: "10px", color: "#555" }}>
                    ({poList.map(po => {
                      const ov = palletOverrides[po.id];
                      const val = ov !== undefined && ov !== "" ? parseInt(ov) : (po.total_pallets || 0);
                      return `${formatPoNumber(po)}: ${val}`;
                    }).join(" | ")})
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
 
    </div>
  );
}