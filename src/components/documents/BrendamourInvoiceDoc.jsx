const nl2br = (str = "") =>
  str.split("\n").map((line, i) => (
    <span key={i}>
      {line}
      <br />
    </span>
  ));

export default function BrendamourInvoiceDoc({ data }) {
  const {
    seller,
    buyer,
    po,
    referenceNumber,
    items = [],
    invoiceNumber,
    invoiceDate,
    currency = "USD",
    logoUrl,
    totalCartons,
    totalValue,
    totalGrossWeight,
    totalNetWeight,
  } = data;

  const cell = { border: "1px solid #000", padding: "3px 3px", fontSize: "7.5px" };
  const hcell = { ...cell, backgroundColor: "#f0f0f0", fontWeight: "bold", textAlign: "center" };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "9px", padding: "12px", backgroundColor: "#fff" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ width: "150px" }}>
          {logoUrl && <img src={logoUrl} alt="logo" style={{ maxHeight: "45px", maxWidth: "150px" }} />}
        </div>
        <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px", textAlign: "center", flex: 1 }}>
          COMMERCIAL INVOICE
        </div>
        <div style={{ width: "150px" }} />
      </div>

      {/* Seller / Buyer */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>SELLER / EXPORTER:</strong>
              <br />
              <div style={{ marginTop: "3px" }}>{nl2br(seller || "")}</div>
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>SOLD TO / CONSIGNEE:</strong>
              <br />
              <div style={{ marginTop: "3px" }}>{nl2br(buyer || "")}</div>
            </td>
          </tr>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", verticalAlign: "top" }}>
              <strong>Invoice Number:</strong> {invoiceNumber || "_____________"}
              <br />
              <strong>Invoice Date:</strong> {invoiceDate || "_____________"}
              <br />
              <strong>Currency:</strong> {currency}
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", verticalAlign: "top" }}>
              <strong>PO Number:</strong> {po || "_____________"}
              <br />
              <strong>Reference Number:</strong> {referenceNumber || "_____________"}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Line items */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            {[
              "UPC",
              "Description",
              "Cases",
              `Unit Price\n(${currency}/case)`,
              `Ext. Amount\n(${currency})`,
              "HS Code",
              "Country of\nOrigin",
            ].map((h) => (
              <th key={h} style={{ ...hcell, whiteSpace: "pre-line" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{ fontSize: "8px" }}>
              <td style={cell}>{item.upc}</td>
              <td style={{ ...cell, wordBreak: "break-word" }}>{item.description}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.cases}</td>
              <td style={{ ...cell, textAlign: "right" }}>{parseFloat(item.unit_price || 0).toFixed(2)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{parseFloat(item.total_amount || 0).toFixed(2)}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.hs_code || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{item.country_of_origin || ""}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: "bold", backgroundColor: "#f9f9f9", fontSize: "8px" }}>
            <td colSpan={2} style={{ ...cell, textAlign: "right" }}>
              TOTALS
            </td>
            <td style={{ ...cell, textAlign: "center" }}>{totalCartons || ""}</td>
            <td style={cell}></td>
            <td style={{ ...cell, textAlign: "right" }}>
              {currency} {(totalValue || 0).toFixed(2)}
            </td>
            <td colSpan={2} style={cell}></td>
          </tr>
        </tbody>
      </table>

      {/* Summary + Signature */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Total Cases:</strong> {totalCartons || 0}
              <br />
              <strong>Total Net Weight:</strong> {(totalNetWeight || 0).toFixed(2)} kg
              <br />
              <strong>Total Gross Weight:</strong> {(totalGrossWeight || 0).toFixed(2)} kg
            </td>
            <td style={{ border: "1px solid #000", padding: "6px", width: "50%", verticalAlign: "top" }}>
              <strong>Total Invoice Value:</strong>
              <br />
              <span style={{ fontSize: "15px", fontWeight: "bold" }}>
                {currency} {(totalValue || 0).toFixed(2)}
              </span>
              <br />
              <br />
              <strong>Authorized Signature:</strong>
              <br />
              <br />
              <br />
              <div
                style={{
                  borderTop: "1px solid #000",
                  marginTop: "20px",
                  paddingTop: "2px",
                  fontSize: "10px",
                  color: "#555",
                }}
              >
                Signature / Date
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Declaration */}
      <div style={{ border: "1px solid #000", padding: "6px", fontSize: "7.5px", lineHeight: "1.4" }}>
        <strong>DECLARATION OF SELLER:</strong> I hereby declare that the above information is true and correct to the
        best of my knowledge and belief, and that the goods described herein originate in the country/countries
        indicated above. These commodities are licensed for the ultimate destination shown above. Diversion contrary
        to U.S. and Canadian law is prohibited. All merchandise is of the country of origin as stated for each line
        item. No U.S. Government export license is required for this shipment.
      </div>
    </div>
  );
}