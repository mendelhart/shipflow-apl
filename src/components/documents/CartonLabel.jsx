import { normalizeUpc, encodeUpcBars, QUIET_MODULES } from "@/domain/upc";

const SHIP_TO = {
  "50": "TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW",
  "55": "TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany"
};

const nl2br = (str = "") =>
  str.split("\n").map((line, i) => (
    <div key={i}>{line}</div>
  ));

function UPCBarcode({ upc }) {
  const { code, checkMismatch, providedCheck } = normalizeUpc(upc);
  const bars = encodeUpcBars(code);

  const barWidth = 2;
  // Bars need a "quiet zone" — blank space, no marks — of ~9 module widths on
  // both sides, or many scanners won't find the symbol at all however correct
  // the digits are.
  const quietWidth = QUIET_MODULES * barWidth;
  const barsWidth = bars.length * barWidth;
  const totalWidth = barsWidth + quietWidth * 2;
  // Height follows width at the GS1 UPC-A ratio (25.9mm tall / 31.35mm of bars)
  // rather than a fixed 60px, so this preview is the same shape as what
  // cartonLabelPdf.js actually prints.
  const height = Math.round(barsWidth * (25.9 / 31.35));

  return (
    <div style={{ textAlign: "center" }}>
      <svg width={totalWidth} height={height + 14} style={{ display: "block", margin: "0 auto" }}>
        {bars.split("").map((b, i) =>
          b === "1" ? (
            <rect key={i} x={quietWidth + i * barWidth} y={0} width={barWidth} height={height} fill="#000" />
          ) : null
        )}
        <text
          x={totalWidth / 2}
          y={height + 12}
          textAnchor="middle"
          fontSize="10"
          fontFamily="monospace"
        >
          {code}
        </text>
      </svg>
      {checkMismatch && (
        <div style={{ color: "#c00", fontWeight: "bold", fontSize: "8px", marginTop: "2px" }}>
          ⚠ UPC check digit mismatch — stored as ...{providedCheck}, verify product UPC
        </div>
      )}
    </div>
  );
}

const FROM_ADDRESS = `Capital Nutrition Inc.
1020 Boul. Michèle-Bohec
Blainville, QC, J7C 5E2
Canada`;

const sectionStyle = {
  border: "2px solid #000",
  padding: "4px",
  boxSizing: "border-box",
  textAlign: "center"
};

export default function CartonLabel({ po, item, boxNumber, totalBoxes }) {
  const shipTo = SHIP_TO[po.po_prefix] || SHIP_TO["50"];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        fontSize: "10px",
        display: "grid",
        gridTemplateRows: "auto auto auto auto auto auto 1fr auto",
        gap: "4px",
        padding: "6px"
      }}
    >

      {/* BOX HEADER */}
      <div style={{ ...sectionStyle, fontWeight: "bold", fontSize: "20px" }}>
        Box {boxNumber} of {totalBoxes}
      </div>

      {/* FROM */}
      <div style={{ ...sectionStyle, lineHeight: "1.3" }}>
        <div style={{ fontWeight: "bold", fontSize: "9px" }}>FROM:</div>
        {FROM_ADDRESS.split("\n").map((line, i) => (
          <div key={i} style={{ fontWeight: "bold" }}>{line}</div>
        ))}
      </div>

      {/* SHIP TO */}
      <div style={{ ...sectionStyle, lineHeight: "1.3" }}>
        <div style={{ fontWeight: "bold" }}>SHIP TO:</div>
        {nl2br(shipTo)}
      </div>

      {/* GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px" }}>
        <div style={sectionStyle}><b>PO</b><br />{po.po_number}</div>
        <div style={sectionStyle}><b>DEPT</b><br />{po.dept_number}</div>
        <div style={sectionStyle}><b>ITEM</b><br />{item.item_number}</div>
        <div style={sectionStyle}><b>STYLE</b><br />{item.vendor_style}</div>
        <div style={sectionStyle}><b>QTY</b><br />{item.units_per_carton}</div>
        <div style={sectionStyle}><b>COO</b><br />{item.country_of_origin || ""}</div>
        <div style={sectionStyle}><b>SIZE</b><br />{item.size}</div>
        <div style={sectionStyle}><b>TICKET</b><br />{po.pre_ticketed ? "Yes" : "No"}</div>
      </div>

      {/* DESCRIPTION */}
      <div style={{ ...sectionStyle, fontWeight: "bold", fontSize: "14px" }}>
        {item.description}
      </div>

      {/* FLEX SPACER */}
      <div />

      {/* BARCODE */}
      {item.upc_code && (
        <div style={{ ...sectionStyle, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <UPCBarcode upc={item.upc_code} />
        </div>
      )}
    </div>
  );
}