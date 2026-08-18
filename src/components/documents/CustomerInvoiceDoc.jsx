import { customerTotals, customerLineTotals } from '@/domain/shipmentTotals';
const nl2br = (str = "") => str.split("\n").map((line, i) => <span key={i}>{line}<br /></span>);

export default function CustomerInvoiceDoc({ data }) {
  const { customer, supplier, po, items = [], invoiceNumber, invoiceDate, currency = "USD" } = data;

  const totalUnits = items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
  const totalValue = items.reduce((s, i) => s + (parseFloat(i.total_amount) || 0), 0);
  // These weights are PER CARTON and `qty` is the carton count, so summing them
  // raw declared a 100-case line as weighing one carton.
  const { grossKg: totalGross, netKg: totalNet } = customerTotals(items);

  const cell = { border: "1px solid #000", padding: "3px 4px", fontSize: "8.5px" };
  const hcell = { ...cell, backgroundColor: "#f0f0f0", fontWeight: "bold", textAlign: "center" };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "9px", padding: "12px", backgroundColor: "#fff" }}>
      <div style={{ textAlign: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "15px", fontWeight: "bold", letterSpacing: "1px" }}>COMMERCIAL INVOICE</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Supplier / Shipper:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(supplier || "")}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Buyer / Consignee:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(customer || "")}</div>
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", verticalAlign: "top" }}>
              <strong>Invoice Number:</strong> {invoiceNumber || "_____________"}<br />
              <strong>Invoice Date:</strong> {invoiceDate || "_____________"}<br />
              <strong>PO Number:</strong> {po || "_____________"}<br />
              <strong>Currency:</strong> {currency}
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", verticalAlign: "top" }}>
              <strong>Ship To / Delivery Address:</strong><br />
              <div style={{ marginTop: "3px" }}>{nl2br(customer || "")}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "27%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            {["UPC", "Description", "Qty", "Pack", `Unit Price\n(${currency})`, `Total\n(${currency})`, "Gross\n(kg)", "Net\n(kg)", "Country of\nOrigin"].map(h => (
              <th key={h} style={{ ...hcell, whiteSpace: "pre-line" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{ fontSize: "9px" }}>
              <td style={cell}>{item.upc}</td>
              <td style={{ ...cell, wordBreak: "break-word" }}>{item.description}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.qty}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.pack}</td>
              <td style={{ ...cell, textAlign: "right" }}>{parseFloat(item.unit_price || 0).toFixed(2)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{parseFloat(item.total_amount || 0).toFixed(2)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{item.gross_weight_kg ? customerLineTotals(item).grossKg.toFixed(2) : ""}</td>
              <td style={{ ...cell, textAlign: "right" }}>{item.net_weight_kg ? customerLineTotals(item).netKg.toFixed(2) : ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.country_of_origin || ""}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f9f9f9", fontSize: "9px" }}>
            <td colSpan={2} style={{ ...cell, textAlign: "right" }}>TOTALS</td>
            <td style={{ ...cell, textAlign: "center" }}>{totalUnits}</td>
            <td style={cell}></td>
            <td style={cell}></td>
            <td style={{ ...cell, textAlign: "right" }}>{currency} {totalValue.toFixed(2)}</td>
            <td style={{ ...cell, textAlign: "right" }}>{totalGross > 0 ? totalGross.toFixed(2) : ""}</td>
            <td style={{ ...cell, textAlign: "right" }}>{totalNet > 0 ? totalNet.toFixed(2) : ""}</td>
            <td style={cell}></td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%" }}>
              <strong>Total Invoice Value:</strong><br />
              <span style={{ fontSize: "15px", fontWeight: "bold" }}>{currency} {totalValue.toFixed(2)}</span>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%" }}>
              <strong>Authorized Signature:</strong><br /><br /><br />
              <div style={{ borderTop: "1px solid #000", marginTop: "20px", paddingTop: "2px", fontSize: "10px", color: "#555" }}>Signature / Date</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}