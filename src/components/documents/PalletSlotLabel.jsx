function UPCBarcode({ upc }) {
  const code = String(upc || "").replace(/\D/g, "").padStart(12, "0").slice(0, 12);

  const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];

  const digits = code.split("").map(Number);

  let bars = "101";
  digits.slice(0, 6).forEach(d => bars += L[d]);
  bars += "01010";
  digits.slice(6, 12).forEach(d => bars += R[d]);
  bars += "101";

  // Scale barcode to fill the available width (~3.0in usable in the right column)
  const targetWidth = 300; // px ≈ 3.1in at 96dpi
  const barWidth = targetWidth / bars.length;
  const height = 120;
  const totalWidth = bars.length * barWidth;

  return (
    <svg width={totalWidth} height={height + 22} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}>
      {bars.split("").map((b, i) =>
        b === "1" ? (
          <rect key={i} x={i * barWidth} y={0} width={barWidth + 0.5} height={height} fill="#000" />
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