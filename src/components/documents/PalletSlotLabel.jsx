import { normalizeUpc, encodeUpcBars, QUIET_MODULES } from "@/domain/upc";
/**
 * Pallet slot barcode.
 *
 * This had its own private copy of the UPC-A encoding tables, plus
 * `padStart(12,'0').slice(0,12)` — which turns the EAN-13 form 0628693015028
 * into 062869301502: wrong check digit, and not the same code as the carton
 * label on the same pallet. It also started bars at x=0 with no quiet zone and
 * widened every dark module by 0.5px against a 3.16px module, a 16% bar-gain
 * error. @/domain/upc exists precisely so there is one encoder.
 */
function UPCBarcode({ upc }) {
  const { code, isEmpty, checkMismatch, providedCheck } = normalizeUpc(upc);
  if (isEmpty) return null;

  const bars = encodeUpcBars(code);
  const targetWidth = 300; // px, ~3.1in at 96dpi — fills the right column
  const barWidth = targetWidth / (bars.length + QUIET_MODULES * 2);
  const quietWidth = QUIET_MODULES * barWidth;
  const barsWidth = bars.length * barWidth;
  const totalWidth = barsWidth + quietWidth * 2;
  // Height follows width at the GS1 ratio (25.9mm tall / 31.35mm of bars).
  const height = Math.round(barsWidth * (25.9 / 31.35));

  return (
    <svg width={totalWidth} height={height + 22} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}>
      {bars.split("").map((b, i) =>
        b === "1" ? (
          <rect key={i} x={quietWidth + i * barWidth} y={0} width={barWidth} height={height} fill="#000" />
        ) : null
      )}
      <text
        x={totalWidth / 2}
        y={height + 18}
        textAnchor="middle"
        fontSize="16"
        fontFamily="monospace"
        fontWeight="bold"
        fill="#000"
      >
        {code}
      </text>
      {checkMismatch && (
        <text x={totalWidth / 2} y={height + 34} textAnchor="middle" fontSize="9" fill="#c00" fontWeight="bold">
          check digit mismatch - stored as ...{providedCheck}
        </text>
      )}
    </svg>
  );
}


const sectionStyle = {
  border: "3px solid #000",
  boxSizing: "border-box",
  color: "#000",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

export default function PalletSlotLabel({ product, appSettings }) {
  const companyName = appSettings?.company_name || "";

  return (
    <div
      style={{
        width: "6in",
        height: "4in",
        padding: "0.12in",
        boxSizing: "border-box",
        pageBreakAfter: "always",
        breakAfter: "page",
        fontFamily: "Arial, sans-serif",
        color: "#000",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      {/* Branding header — compact */}
      {companyName && (
        <div style={{ textAlign: "center", fontSize: "11px", fontWeight: "bold", borderBottom: "2px solid #000", paddingBottom: "2px", flex: "0 0 auto" }}>
          {appSettings?.show_logo_on_documents && appSettings?.logo_url && (
            <img src={appSettings.logo_url} alt="logo" style={{ maxHeight: "20px", marginRight: "6px", verticalAlign: "middle" }} />
          )}
          {companyName}
        </div>
      )}

      {/* Product description — large, full width, fills top band */}
      <div
        style={{
          ...sectionStyle,
          fontWeight: "bold",
          fontSize: "30px",
          textAlign: "center",
          lineHeight: 1.05,
          padding: "8px 10px",
          flex: "0 1 auto",
        }}
      >
        {product.description || "—"}
      </div>

      {/* Body: left details column + right barcode column — fills remaining height */}
      <div style={{ display: "flex", gap: "5px", flex: "1 1 auto", minHeight: 0 }}>
        {/* Left: three detail boxes stacked, each fills equal vertical space */}
        <div style={{ flex: "1 1 38%", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ ...sectionStyle, flex: "1 1 0", padding: "4px 10px", alignItems: "flex-start" }}>
            <span style={{ fontWeight: "bold", fontSize: "11px", letterSpacing: "0.5px" }}>ITEM #</span>
            <span style={{ fontSize: "22px", fontWeight: "bold", lineHeight: 1.1 }}>{product.item_number || "—"}</span>
          </div>
          <div style={{ ...sectionStyle, flex: "1 1 0", padding: "4px 10px", alignItems: "flex-start" }}>
            <span style={{ fontWeight: "bold", fontSize: "11px", letterSpacing: "0.5px" }}>SIZE</span>
            <span style={{ fontSize: "22px", fontWeight: "bold", lineHeight: 1.1 }}>{product.size || "—"}</span>
          </div>
          <div style={{ ...sectionStyle, flex: "1 1 0", padding: "4px 10px", alignItems: "flex-start" }}>
            <span style={{ fontWeight: "bold", fontSize: "11px", letterSpacing: "0.5px" }}>UNITS / CARTON</span>
            <span style={{ fontSize: "24px", fontWeight: "bold", lineHeight: 1.1 }}>{product.units_per_carton || "—"}</span>
          </div>
        </div>

        {/* Right: UPC text + barcode — fills the column */}
        <div style={{ ...sectionStyle, flex: "1 1 62%", padding: "6px 8px", alignItems: "center", justifyContent: "center", gap: "4px" }}>
          <div style={{ fontWeight: "bold", fontSize: "11px", letterSpacing: "0.5px" }}>CASE UPC</div>
          <div style={{ fontSize: "15px", fontFamily: "monospace", fontWeight: "bold" }}>
            {product.upc_code || "—"}
          </div>
          {product.upc_code && (
            <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", flex: "1 1 auto" }}>
              <UPCBarcode upc={product.upc_code} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}