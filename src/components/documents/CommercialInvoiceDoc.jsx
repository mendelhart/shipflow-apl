import { format } from "date-fns";
import { formatPoNumber } from "@/utils/poNumber";
 
const ADDRESSES = {
  "50": {
    delivery: "TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW",
    buyer: "TJX UK\n73 Clarendon Road, Watford, Herts\nWD17 1TX United Kingdom"
  },
  "55": {
    delivery: "TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany",
    buyer: "TJX UK\n73 Clarendon Road, Watford, Herts\nWD17 1TX United Kingdom"
  }
};
 
const nl2br = (str = "") => str.split("\n").map((line, i) => <span key={i}>{line}<br /></span>);

// UK Origin Declaration (new TJX compliance requirement, prefix "50"
// shipments only): defaults to USA, but reflects the actual set of
// countries of origin present on this invoice's items — e.g.
// "USA and Canada" if a shipment mixes origins, rather than always
// claiming a single origin that might not be accurate for every line item.
function getOriginDeclarationText(items) {
  const origins = [...new Set((items || []).map(i => (i.country_of_origin || "USA").trim()).filter(Boolean))];
  if (origins.length === 0) return "USA";
  if (origins.length === 1) return origins[0];
  return origins.slice(0, -1).join(", ") + " and " + origins[origins.length - 1];
}

// "Place and date" — prefilled from the vendor's own city/province/country
// plus today's date. "Date should be the date of printing" — always the
// generation-time date, not the invoice date, since this represents when
// the document/signature was actually produced.
function getPlaceAndDate(vendor) {
  const place = [vendor.city, vendor.state_province, vendor.country].filter(Boolean).join(", ") || "";
  const dateStr = format(new Date(), "dd/MM/yyyy");
  return place ? `${place}, ${dateStr}` : dateStr;
}
 
export default function CommercialInvoiceDoc({ po, vendor, settings = {} }) {
  const addr = ADDRESSES[po.po_prefix] || ADDRESSES["50"];
  const items = po.items || [];
  const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
  const totalUnits = items.reduce((s, i) => s + (parseFloat(i.total_units) || 0), 0);
  const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
  const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
  const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);
  // unit_price is price per unit; total value = total_units × unit_price
  const totalValue = items.reduce((s, i) => s + (parseFloat(i.total_units) || 0) * (parseFloat(i.unit_price) || 0), 0);
 
  const vendorAddr = [vendor.company_name, vendor.address_line1, vendor.address_line2, vendor.city && `${vendor.city}${vendor.state_province ? ", " + vendor.state_province : ""}`, vendor.postal_code, vendor.country].filter(Boolean).join("\n");
 
  const cur = po.currency || "CAD";
 
  const cell = { border: "1px solid #000", padding: "3px 4px", fontSize: "9px" };
  const hcell = { ...cell, backgroundColor: "#f0f0f0", fontWeight: "bold", textAlign: "center", fontSize: "8.5px" };

  const originText = getOriginDeclarationText(items);
  const exporterName = po.exporter_name || settings.exporter_name || "Mendel Hart";
  const exporterTitle = po.exporter_title || settings.exporter_title || "Business Development Director";
  const placeAndDate = getPlaceAndDate(vendor);
  const printDate = format(new Date(), "dd/MM/yyyy");
  const signatureStyle = { fontFamily: "'Alex Brush', 'Brush Script MT', cursive", color: "#1e3cc8", fontSize: "20px" };
 
  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "10px", padding: "12px", backgroundColor: "#fff" }}>
      <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "16px", fontWeight: "bold" }}>COMMERCIAL INVOICE</div>
      </div>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px", fontSize: "10px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "5px", width: "50%", verticalAlign: "top" }}>
              <strong>Vendor (Name and Address)</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(vendorAddr)}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "5px", width: "50%", verticalAlign: "top" }}>
              <strong>Buyer / Consignee:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(addr.buyer)}</div>
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "5px", verticalAlign: "top" }}>
              <strong>Invoice Number:</strong> {po.invoice_number || "_____________"}<br />
              <strong>Invoice Date:</strong> {po.invoice_date ? format(new Date(po.invoice_date), "dd/MM/yyyy") : "_____________"}<br />
              <strong>PO Number:</strong> {formatPoNumber(po)}<br />
              <strong>Dept No:</strong> {po.dept_number} &nbsp;&nbsp; <strong>Freight:</strong> {po.freight_terms} &nbsp;&nbsp; <strong>Currency:</strong> {cur}
            </td>
            <td style={{ border: "1px solid #000", padding: "5px", verticalAlign: "top" }}>
              <strong>Delivery Address:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(addr.delivery)}</div>
            </td>
          </tr>
        </tbody>
      </table>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead>
          <tr>
            {[
              "Item #", "Vendor Style", "Description", "HS Code", "COO", "Size",
              "Units/Ctn", "# Ctns", "Total Units", `Unit Price\n(${cur})`, `Total Value\n(${cur})`
            ].map(h => (
              <th key={h} style={{ ...hcell, whiteSpace: "pre-line" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const hsb = "2106.90.99.98";
            return (
              <tr key={i} style={{ fontSize: "9px" }}>
                <td style={cell}>{item.item_number}</td>
                <td style={cell}>{item.vendor_style}</td>
                <td style={{ ...cell, wordBreak: "break-word" }}>{item.description}</td>
                <td style={cell}>{hsb}</td>
                <td style={{ ...cell, textAlign: "center" }}>{item.country_of_origin || "USA"}</td>
                <td style={{ ...cell, textAlign: "center" }}>{item.size}</td>
                <td style={{ ...cell, textAlign: "center" }}>{item.units_per_carton}</td>
                <td style={{ ...cell, textAlign: "center" }}>{item.num_cartons}</td>
                <td style={{ ...cell, textAlign: "center" }}>{item.total_units}</td>
                <td style={{ ...cell, textAlign: "right" }}>{parseFloat(item.unit_price || 0).toFixed(2)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{((parseFloat(item.total_units) || 0) * (parseFloat(item.unit_price) || 0)).toFixed(2)}</td>
              </tr>
            );
          })}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f9f9f9", fontSize: "9px" }}>
            <td colSpan={7} style={{ ...cell, textAlign: "right" }}>TOTALS</td>
            <td style={{ ...cell, textAlign: "center" }}>{totalCartons}</td>
            <td style={{ ...cell, textAlign: "center" }}>{totalUnits}</td>
            <td style={cell}></td>
            <td style={{ ...cell, textAlign: "right" }}>{cur} {totalValue.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "33%" }}>
              <strong>Total Cartons:</strong> {totalCartons}<br />
              <strong>Total Gross Weight:</strong> {totalGross.toFixed(2)} kg<br />
              <strong>Total Net Weight:</strong> {totalNet.toFixed(2)} kg<br />
              <strong>Total Volume:</strong> {totalCbm.toFixed(6)} M³
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "33%" }}>
              <strong>Total Invoice Value:</strong><br />
              <span style={{ fontSize: "15px", fontWeight: "bold" }}>{cur} {totalValue.toFixed(2)}</span>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "33%" }}>
              <strong>Authorized Signature:</strong><br />
              <span style={signatureStyle}>{exporterName}</span>
              <div style={{ borderTop: "1px solid #000", marginTop: "4px", paddingTop: "2px", fontSize: "9px" }}>
                Date: <strong>{printDate}</strong>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
 
      {po.notes && (
        <div style={{ border: "1px solid #000", padding: "6px", fontSize: "11px", marginBottom: "8px" }}>
          <strong>Notes:</strong> {po.notes}
        </div>
      )}

      {/* Origin Declaration — new TJX compliance requirement, UK (prefix "50") shipments only */}
      {po.po_prefix === "50" && (
        <div style={{ border: "1px solid #000", padding: "8px", fontSize: "9px" }}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Origin Declaration</div>
          <div style={{ lineHeight: "1.5", marginBottom: "10px" }}>
            The exporter of the products covered by this document (customs identification No. {settings.customs_id || "785337692RM0003"})
            declares that, except where otherwise clearly indicated, these products are of {originText} preferential origin.
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
            <strong>Place and date: {placeAndDate}</strong>
            <span>Name and signature of the exporter:</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
            <div style={{ textAlign: "right" }}>
              <div>{exporterName}</div>
              <span style={signatureStyle}>{exporterName}</span>
            </div>
          </div>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Manufacturer Name and Address (if different than Vendor):</div>
          <div style={{ borderBottom: "1px solid #000", height: "16px", marginBottom: "10px" }}></div>

          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
            <strong>Responsible Party Information:</strong>
            <strong>Signature</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
            <span style={signatureStyle}>{exporterName}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <span>Name: {exporterName}</span>
            <span>Tittle: {exporterTitle}</span>
          </div>
        </div>
      )}
    </div>
  );
}