import { format, parseISO } from "date-fns";

const nl2br = (str = "") =>
  str.split("\n").map((line, i) => (
    <span key={i}>
      {line}
      <br />
    </span>
  ));

export default function InboundVerificationDoc({ data }) {
  const {
    seller,
    buyer,
    po,
    referenceNumber,
    items = [],
    invoiceNumber,
    ship_date,
    logoUrl,
    reportTotals = {},
    totalCartons,
  } = data;

  const cell = { border: "1px solid #000", padding: "4px 5px", fontSize: "8.5px" };
  const hcell = { ...cell, backgroundColor: "#f0f0f0", fontWeight: "bold", textAlign: "center" };
  const blankCell = { ...cell, backgroundColor: "#fffde7", minHeight: "24px" };

  const formattedShipDate = ship_date
    ? format(parseISO(ship_date), "MM/dd/yyyy")
    : "_____________";

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "9px", padding: "12px", backgroundColor: "#fff" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ width: "150px" }}>
          {logoUrl && <img src={logoUrl} alt="logo" style={{ maxHeight: "45px", maxWidth: "150px" }} />}
        </div>
        <div style={{ fontSize: "15px", fontWeight: "bold", letterSpacing: "1px", textAlign: "center", flex: 1 }}>
          INBOUND SHIPMENT
          <br />
          VERIFICATION SHEET
        </div>
        <div style={{ width: "150px" }} />
      </div>

      {/* Seller / Buyer */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>SHIPPER / SELLER:</strong>
              <br />
              <div style={{ marginTop: "3px" }}>{nl2br(seller || "")}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>RECEIVER / BUYER:</strong>
              <br />
              <div style={{ marginTop: "3px" }}>{nl2br(buyer || "")}</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Shipment info */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px" }}>
              <strong>Transaction #:</strong> {invoiceNumber || "_____________"}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px" }}>
              <strong>PO #:</strong> {po || "_____________"}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px" }}>
              <strong>Ship Date:</strong> {formattedShipDate}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px" }}>
              <strong>Ref #:</strong> {referenceNumber || "_____________"}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Report totals */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px", textAlign: "center" }}>
              <strong>Total Cases:</strong> {reportTotals.totalCartons || totalCartons || "—"}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px", textAlign: "center" }}>
              <strong>Total Pallets:</strong> {reportTotals.totalPallets || "—"}
            </td>
            <td style={{ border: "1px solid #000", padding: "4px 6px", fontSize: "9px", textAlign: "center" }}>
              <strong>Total Weight:</strong> {reportTotals.totalWeight || "—"}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Verification table */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            {["Case UPC", "Description / Flavor", "Lot Number", "Exp. Cases", "Cases Received", "Discrepancy", "Condition / Notes"].map((h) => (
              <th key={h} style={hcell}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{ fontSize: "9px" }}>
              <td style={cell}>{item.upc}</td>
              <td style={{ ...cell, wordBreak: "break-word" }}>{item.description}</td>
              <td style={cell}>{item.lot_number || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.cases}</td>
              <td style={blankCell}></td>
              <td style={blankCell}></td>
              <td style={blankCell}></td>
            </tr>
          ))}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f9f9f9", fontSize: "9px" }}>
            <td colSpan={3} style={{ ...cell, textAlign: "right" }}>TOTAL EXPECTED CASES</td>
            <td style={{ ...cell, textAlign: "center" }}>{totalCartons || 0}</td>
            <td colSpan={3} style={cell}></td>
          </tr>
        </tbody>
      </table>

      {/* Signature */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "8px", width: "48%", fontSize: "9px", verticalAlign: "bottom" }}>
              <strong>Received By:</strong>
              <br />
              <br />
              <br />
              <div style={{ borderTop: "1px solid #000", paddingTop: "2px", fontSize: "8px", color: "#555" }}>
                Signature / Date
              </div>
            </td>
            <td style={{ width: "4%" }}></td>
            <td style={{ border: "1px solid #000", padding: "8px", width: "48%", fontSize: "9px", verticalAlign: "bottom" }}>
              <strong>Verified By:</strong>
              <br />
              <br />
              <br />
              <div style={{ borderTop: "1px solid #000", paddingTop: "2px", fontSize: "8px", color: "#555" }}>
                Signature / Date
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}