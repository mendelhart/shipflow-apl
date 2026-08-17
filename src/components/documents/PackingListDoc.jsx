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
 
export default function PackingListDoc({ po, vendor }) {
  const addr = ADDRESSES[po.po_prefix] || ADDRESSES["50"];
  const items = po.items || [];
  const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
  const totalUnits = items.reduce((s, i) => s + (parseFloat(i.total_units) || 0), 0);
  const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
  const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
  const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);
 
  const vendorAddr = [vendor.company_name, vendor.address_line1, vendor.address_line2, vendor.city && `${vendor.city}${vendor.state_province ? ", " + vendor.state_province : ""}`, vendor.postal_code, vendor.country].filter(Boolean).join("\n");
 
  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "12px", padding: "16px", backgroundColor: "#fff" }}>
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <div style={{ fontSize: "20px", fontWeight: "bold" }}>PACKING LIST</div>
        <div style={{ fontSize: "11px", color: "#555" }}>Page 1 of 1</div>
      </div>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Vendor Name &amp; Address</strong><br />
              <div style={{ marginTop: "4px" }}>{nl2br(vendorAddr)}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Buyer / Consignee:</strong><br />
              <div style={{ marginTop: "4px" }}>{nl2br(addr.buyer)}</div>
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", verticalAlign: "top" }}>
              <strong>Delivery Address:</strong><br />
              <div style={{ marginTop: "4px" }}>{nl2br(addr.delivery)}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", verticalAlign: "top" }}>
              <strong>Invoice #:</strong> {po.invoice_number || "_____________"}<br />
              <strong>Invoice Date:</strong> {po.invoice_date ? format(new Date(po.invoice_date), "dd/MM/yyyy") : "_____________"}<br />
              <strong>PO Number:</strong> {formatPoNumber(po)}<br />
              <strong>Dept No:</strong> {po.dept_number}<br />
              <strong>Country of Origin:</strong> (see below)
            </td>
          </tr>
        </tbody>
      </table>
 
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <thead>
          <tr style={{ backgroundColor: "#f0f0f0" }}>
            {["Item #","Vendor Style","Description","Size","COO","Units/Ctn","# Cartons","Total Units","Gross Wt (kg)","Net Wt (kg)","CBM"].map(h => (
              <th key={h} style={{ border: "1px solid #000", padding: "5px", fontSize: "11px", textAlign: "center" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #000", padding: "4px" }}>{item.item_number}</td>
              <td style={{ border: "1px solid #000", padding: "4px" }}>{item.vendor_style}</td>
              <td style={{ border: "1px solid #000", padding: "4px" }}>{item.description}</td>
              <td style={{ border: "1px solid #000", padding: "4px" }}>{item.size}</td>
              <td style={{ border: "1px solid #000", padding: "4px" }}>{item.country_of_origin || "USA"}</td>
              <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{item.units_per_carton}</td>
              <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{item.num_cartons}</td>
              <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{item.total_units}</td>
              <td style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>{((parseFloat(item.num_cartons)||0)*(parseFloat(item.net_weight_kg)||0)).toFixed(2)}</td>
              <td style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>{((parseFloat(item.num_cartons)||0)*(parseFloat(item.gross_weight_kg)||0)).toFixed(2)}</td>
              <td style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>{((parseFloat(item.num_cartons)||0)*(parseFloat(item.cbm)||0)).toFixed(6)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f9f9f9" }}>
            <td colSpan={6} style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>TOTALS</td>
            <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{totalCartons}</td>
            <td style={{ border: "1px solid #000", padding: "4px", textAlign: "center" }}>{totalUnits}</td>
            <td style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>{totalGross.toFixed(2)}</td>
            <td style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>{totalNet.toFixed(2)}</td>
            <td style={{ border: "1px solid #000", padding: "4px", textAlign: "right" }}>{totalCbm.toFixed(6)}</td>
          </tr>
        </tbody>
      </table>
 
      <div style={{ border: "1px solid #000", padding: "6px", fontSize: "11px", fontStyle: "italic" }}>
        A copy of this packing list must be securely attached on the carton at the moment of delivery.
      </div>
    </div>
  );
}
 