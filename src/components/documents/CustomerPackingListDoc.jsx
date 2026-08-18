import { customerTotals, customerLineTotals } from '@/domain/shipmentTotals';
const nl2br = (str = "") => str.split("\n").map((line, i) => <span key={i}>{line}<br /></span>);

export default function CustomerPackingListDoc({ data }) {
  const { customer, supplier, po, items = [], invoiceNumber, invoiceDate } = data;

  const totalUnits = items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
  // Two defects here: the per-carton weight was printed as the line total, and
  // min/max silently reordered gross and net so this document disagreed with the
  // invoice in the same packet whenever the stored data had net above gross.
  // Print what is stored; bad data should be visible, not smoothed over.
  const { grossKg: totalGross, netKg: totalNet } = customerTotals(items);

  const cell = { border: "1px solid #000", padding: "3px 4px", fontSize: "8.5px" };
  const hcell = { ...cell, backgroundColor: "#f0f0f0", fontWeight: "bold", textAlign: "center" };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "9px", padding: "12px", backgroundColor: "#fff" }}>
      <div style={{ textAlign: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "15px", fontWeight: "bold", letterSpacing: "1px" }}>PACKING LIST</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Supplier / Shipper:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(supplier || "")}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Ship To / Buyer:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(customer || "")}</div>
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px" }}>
              <strong>Invoice #:</strong> {invoiceNumber || "_____________"}<br />
              <strong>Invoice Date:</strong> {invoiceDate || "_____________"}
            </td>
            <td style={{ border: "1px solid #000", padding: "6px" }}>
              <strong>PO Number:</strong> {po || "_____________"}
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            {["UPC", "Description", "Pack Size", "Qty", "Gross kg", "Net kg", "COO", "HS Code"].map(h => (
              <th key={h} style={hcell}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{ fontSize: "9px" }}>
              <td style={cell}>{item.upc}</td>
              <td style={{ ...cell, wordBreak: "break-word" }}>{item.description}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.pack}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.qty}</td>
              <td style={{ ...cell, textAlign: "right" }}>{item.gross_weight_kg ? customerLineTotals(item).grossKg.toFixed(2) : ""}</td>
              <td style={{ ...cell, textAlign: "right" }}>{item.net_weight_kg ? customerLineTotals(item).netKg.toFixed(2) : ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.country_of_origin || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.hs_code || ""}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f9f9f9", fontSize: "9px" }}>
            <td colSpan={3} style={{ ...cell, textAlign: "right" }}>TOTALS</td>
            <td style={{ ...cell, textAlign: "center" }}>{totalUnits}</td>
            <td style={{ ...cell, textAlign: "right" }}>{totalGross ? totalGross.toFixed(2) : ""}</td>
            <td style={{ ...cell, textAlign: "right" }}>{totalNet ? totalNet.toFixed(2) : ""}</td>
            <td colSpan={2} style={cell}></td>
          </tr>
        </tbody>
      </table>

      <div style={{ border: "1px solid #000", padding: "6px", fontSize: "10px", fontStyle: "italic" }}>
        A copy of this packing list must be securely attached to the shipment at the time of delivery.
      </div>
    </div>
  );
}