const SHIP_TO = {
  "50": "TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW",
  "55": "TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany"
};

const nl2br = (str = "") => str.split("\n").map((line, i) => <span key={i}>{line}<br /></span>);

const sectionStyle = {
  border: "2px solid #000",
  padding: "5px 7px",
  color: "#000",
  marginBottom: "4px",
};

export default function PalletLabel({ po, vendor, palletNumber, totalPallets }) {
  const shipTo = SHIP_TO[po.po_prefix] || SHIP_TO["50"];
  const items = po.items || [];
  const totalCartons = items.reduce((s, i) => s + (parseInt(i.num_cartons) || 0), 0);

  return (
    <div style={{
      width: "4in",
      height: "6in",
      padding: "0.2in",
      boxSizing: "border-box",
      pageBreakAfter: "always",
      breakAfter: "page",
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#000",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      // NO outer border
    }}>

      {/* Pallet count */}
      <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "24px", border: "2px solid #000", padding: "6px", color: "#000" }}>
        PALLET {palletNumber} of {totalPallets}
      </div>

      {/* From / Ship To */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
        <div style={sectionStyle}>
          <div style={{ fontWeight: "bold", fontSize: "10px", marginBottom: "2px" }}>FROM:</div>
          <div style={{ fontSize: "12px" }}>{vendor.company_name}</div>
          <div>{vendor.address_line1}</div>
          <div>{vendor.city}{vendor.country ? `, ${vendor.country}` : ""}</div>
        </div>
        <div style={sectionStyle}>
          <div style={{ fontWeight: "bold", fontSize: "10px", marginBottom: "2px" }}>SHIP TO:</div>
          <div style={{ fontSize: "12px" }}>{nl2br(shipTo)}</div>
        </div>
      </div>

      {/* PO Number large */}
      <div style={{ ...sectionStyle, marginBottom: 0 }}>
        <div style={{ fontWeight: "bold", fontSize: "10px" }}>PO NUMBER</div>
        <div style={{ fontSize: "20px", fontWeight: "bold" }}>{po.po_number}</div>
      </div>

      {/* Details grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", fontSize: "12px" }}>
        <div style={sectionStyle}><div style={{ fontWeight: "bold", fontSize: "10px" }}>DEPT NO</div>{po.dept_number}</div>
        <div style={sectionStyle}><div style={{ fontWeight: "bold", fontSize: "10px" }}>TOTAL CARTONS</div>{totalCartons}</div>
        <div style={sectionStyle}><div style={{ fontWeight: "bold", fontSize: "10px" }}>TOTAL PALLETS</div>{po.total_pallets}</div>
        <div style={sectionStyle}><div style={{ fontWeight: "bold", fontSize: "10px" }}>GROSS WEIGHT</div>{po.total_gross_weight_kg} kg</div>
        <div style={{ ...sectionStyle, gridColumn: "1 / -1" }}><div style={{ fontWeight: "bold", fontSize: "10px" }}>CBM</div>{po.total_cbm} M³</div>
      </div>

      {/* Footer note */}
      <div style={{ marginTop: "auto", fontSize: "10px", color: "#000", borderTop: "2px solid #000", paddingTop: "5px", fontWeight: "bold" }}>
        Pallets must be Heat Treated or Fumigated | ISO 17712 seal required
      </div>
    </div>
  );
}