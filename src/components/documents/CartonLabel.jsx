const SHIP_TO = {
  "50": "TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW",
  "55": "TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany"
};

const nl2br = (str = "") =>
  str.split("\n").map((line, i) => (
    <div key={i}>{line}</div>
  ));

// Standard UPC-A check-digit algorithm (mod-10, 3x weight on odd positions).
// positions are 1-indexed against the 11 data digits.
function computeUpcCheckDigit(dataDigits) {
  let oddSum = 0, evenSum = 0;
  dataDigits.forEach((d, i) => {
    const pos = i + 1;
    if (pos % 2 === 1) oddSum += d; else evenSum += d;
  });
  const total = oddSum * 3 + evenSum;
  return (10 - (total % 10)) % 10;
}

// Normalizes a raw UPC value into a correct 12-digit UPC-A code, always
// deriving the check digit ourselves rather than trusting whatever was
// stored — plus flags it when the stored value's own check digit doesn't
// match, so a bad product UPC is visible before the carton ships instead
// of silently printing a barcode that scans as the wrong item (or doesn't
// scan at all).
//
// FIX: the old version did `String(upc).replace(/\D/g,"").padStart(12,"0")`
// — for an 11-digit UPC (data digits only, no check digit — a very common
// way UPCs get entered), that padding put a 0 on the FRONT, shifting every
// digit's position and encoding a completely different number than
// intended. It also never checked whether the last digit was actually a
// valid check digit for the rest, so a single typo in product data would
// silently produce a barcode that fails checksum at any real scanner.
function normalizeUpc(rawUpc) {
  const digitsStr = String(rawUpc || "").replace(/\D/g, "");
  let dataStr;
  let providedCheck = null;

  if (digitsStr.length >= 12) {
    // Last 12 digits: first 11 are data, 12th is the UPC's own check digit.
    const last12 = digitsStr.slice(-12);
    dataStr = last12.slice(0, 11);
    providedCheck = parseInt(last12[11], 10);
  } else if (digitsStr.length === 11) {
    // 11 data digits with no check digit supplied — compute one.
    dataStr = digitsStr;
  } else {
    // Fewer than 11 digits: zero-pad the DATA portion on the left, which is
    // the correct GS1 convention (short codes are right-justified), rather
    // than padding the combined data+check string as a single 12-digit blob.
    dataStr = digitsStr.padStart(11, "0");
  }

  const dataDigits = dataStr.split("").map(Number);
  const computedCheck = computeUpcCheckDigit(dataDigits);
  const checkMismatch = providedCheck !== null && providedCheck !== computedCheck;

  return {
    code: dataStr + String(computedCheck), // always use the correctly computed check digit
    checkMismatch,
    providedCheck,
  };
}

function UPCBarcode({ upc }) {
  const { code, checkMismatch, providedCheck } = normalizeUpc(upc);

  const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];

  const digits = code.split("").map(Number);

  let bars = "101";
  digits.slice(0, 6).forEach(d => bars += L[d]);
  bars += "01010";
  digits.slice(6, 12).forEach(d => bars += R[d]);
  bars += "101";

  const barWidth = 2;
  // FIX: bars previously started at x=0 with no blank margin on either
  // side. UPC-A scanners require a "quiet zone" (blank space, no marks) of
  // roughly 9 module-widths on both sides to detect where the barcode
  // starts/stops — without it, many real scanners won't recognize this as
  // a barcode at all, even if the encoded digits are perfectly correct.
  const quietModules = 9;
  const quietWidth = quietModules * barWidth;
  const barsWidth = bars.length * barWidth;
  const totalWidth = barsWidth + quietWidth * 2;
  const height = 60;

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
        <div style={sectionStyle}><b>COO</b><br />USA</div>
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