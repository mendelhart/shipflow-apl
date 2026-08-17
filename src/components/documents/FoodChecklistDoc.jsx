import { format } from "date-fns";
import { formatPoNumber } from "@/utils/poNumber";

const DEST = {
  "50": "United Kingdom",
  "55": "Germany"
};

const cell = {
  border: "1px solid #000",
  padding: "3px 5px",
  verticalAlign: "middle"
};

const labelCell = {
  ...cell,
  backgroundColor: "#f2f2f2",
  fontWeight: "bold",
  width: "38%"
};

const valueCell = {
  ...cell,
  width: "62%"
};

// ============================
// TAB 1 (MAIN FORM) — REBUILT
// ============================
function FDCTab1({ po, vendor, item, prod }) {
  const coo = prod?.fdc_consolidated_coo || item.country_of_origin || "USA";

  // Quantities ALWAYS from PO item — never override with product catalog defaults
  const numCartons = item.num_cartons ?? "";
  const unitsPerCarton = item.units_per_carton ?? prod?.units_per_carton ?? 6;
  const totalUnits = item.total_units ?? (numCartons !== "" ? Number(numCartons) * Number(unitsPerCarton) : "");

  const rows = [
    ["VENDOR NAME", vendor.company_name],
    ["VENDOR STYLE #", item.vendor_style || item.item_number || ""],
    ["DETAILED PRODUCT DESCRIPTION", item.description || prod?.description || ""],
    ["CONSOLIDATED COUNTRY OF ORIGIN", coo],
    ["PRODUCT SIZE / VOLUME", item.size || prod?.size || "750ml"],
    ["UNITS PER CARTON", unitsPerCarton],
    ["NUMBER OF CARTONS (FOR THIS PO)", numCartons],
    ["TOTAL UNITS (FOR THIS PO)", totalUnits],
    ["UPC / BARCODE", item.upc_code || prod?.upc_code || ""],
    ["HS CODE", item.hs_code || prod?.hs_code || ""],
    ["PO NUMBER", formatPoNumber(po)],
    ["DEPARTMENT NUMBER", po.dept_number || ""],
    ["DESTINATION", DEST[po.po_prefix] || "UK"],
    ["INVOICE NUMBER", po.invoice_number || ""],
    ["INVOICE DATE", po.invoice_date ? format(new Date(po.invoice_date), "dd/MM/yyyy") : ""],
    ["SHELF LIFE (days)", prod?.shelf_life_days || ""],
    ["STORAGE INSTRUCTIONS", prod?.storage_instructions || "Store at room temperature"]
  ];

  return (
    <div style={{ fontFamily: "Arial", fontSize: "10px", padding: "12px", pageBreakAfter: "always" }}>
      
      {/* HEADER */}
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <div style={{ fontSize: "13px", fontWeight: "bold" }}>
          FOOD DETAIL CHECKLIST
        </div>
        <div style={{ fontSize: "9px" }}>Form 1</div>
      </div>

      {/* MAIN GRID */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([label, val], i) => (
            <tr key={i}>
              <td style={labelCell}>{label}</td>
              <td style={valueCell}>{String(val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================
// FORM 2 — INGREDIENTS
// ============================
function FDCForm1({ po, item, prod }) {
  const ingList = prod?.fdc_ingredients || [];

  return (
    <div style={{ fontFamily: "Arial", fontSize: "9px", padding: "12px", pageBreakAfter: "always" }}>
      
      {/* HEADER */}
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <div style={{ fontSize: "13px", fontWeight: "bold" }}>
          FOOD DETAIL CHECKLIST
        </div>
        <div style={{ fontSize: "9px" }}>Form 2 – Ingredients</div>
      </div>

      {/* TABLE */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#eaeaea" }}>
            <th style={{ ...cell, width: "38%" }}>INGREDIENT</th>
            <th style={{ ...cell, width: "15%" }}>% BY WEIGHT</th>
            <th style={{ ...cell, width: "17%" }}>E NUMBER</th>
            <th style={{ ...cell, width: "30%" }}>COUNTRY OF ORIGIN</th>
          </tr>
        </thead>

        <tbody>
          {(ingList.length ? ingList : (prod?.ingredients || "").split(",").filter(Boolean).map(s => ({ name: s.trim(), pct_by_weight: "", country_of_origin: "" }))).map((ing, i) => (
            <tr key={i}>
              <td style={cell}>{ing.name || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{ing.pct_by_weight || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{ing.e_number || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{ing.country_of_origin || ""}</td>
            </tr>
          ))}

          {/* FILL EMPTY ROWS up to minimum of 10 total */}
          {Array.from({ length: Math.max(0, 10 - (ingList.length || (prod?.ingredients || "").split(",").filter(Boolean).length)) }).map((_, i) => (
            <tr key={"b" + i}>
              <td style={cell}>&nbsp;</td>
              <td style={cell}></td>
              <td style={cell}></td>
              <td style={cell}></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: "8px", marginTop: "4px" }}>
        * Must total 100%. Use "&lt;0.5%" where applicable.
      </div>
    </div>
  );
}

// ============================
// FORM 3 — EU / ANIMAL
// ============================
function FDCForm2({ po, vendor, item, prod }) {
  const ingList = prod?.fdc_ingredients || [];

  return (
    <div style={{ fontFamily: "Arial", fontSize: "9px", padding: "12px", pageBreakAfter: "always" }}>
      
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <div style={{ fontSize: "13px", fontWeight: "bold" }}>
          FOOD DETAIL CHECKLIST
        </div>
        <div style={{ fontSize: "9px" }}>Form 3 – EU Compliance</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#eaeaea" }}>
            <th style={cell}>INGREDIENT</th>
            <th style={cell}>E#</th>
            <th style={cell}>%</th>
            <th style={cell}>COO</th>
            <th style={cell}>TYPE</th>
            <th style={cell}>APPROVAL #</th>
            <th style={cell}>DAIRY HT</th>
            <th style={cell}>EGG HT</th>
          </tr>
        </thead>

        <tbody>
          {ingList.map((ing, i) => (
            <tr key={i}>
              <td style={cell}>{ing.name}</td>
              <td style={cell}>{ing.e_number || ""}</td>
              <td style={cell}>{ing.pct_by_weight}</td>
              <td style={cell}>{ing.country_of_origin}</td>
              <td style={cell}>{ing.animal_or_plant}</td>
              <td style={cell}>{ing.approval_number}</td>
              <td style={cell}>{ing.heat_treatment}</td>
              <td style={cell}>{ing.heat_treatment_eggs}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* SIGNATURE */}
      <div style={{ marginTop: "20px", borderTop: "1px solid #000", paddingTop: "10px" }}>
        Vendor Signature: __________________________
      </div>
    </div>
  );
}

// ============================
// REPEAT VENDOR APPROVAL
// ============================
export function RepeatVendorApprovalDoc({ po, vendor }) {
  const items = po.items || [];

  return (
    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "10px", backgroundColor: "#fff", width: "100%", maxWidth: "816px", minHeight: "1056px", padding: "36px 48px", boxSizing: "border-box", margin: "0 auto" }}>

      {/* HEADER */}
      <div style={{ marginBottom: "24px" }}>
        <img src="https://media.base44.com/images/public/69b77fe17f63d9da1603f490/4586c1ce5_HeaderTJX.png" alt="TJX Europe" style={{ width: "100%", height: "auto", display: "block" }} />
      </div>

      <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "12px", textDecoration: "underline", marginBottom: "20px" }}>
        REPEAT ORDERS PROCESS
      </div>

      <p style={{ marginBottom: "8px" }}><strong>From: TJX Europe, 73 Clarendon Road, Watford, Herts, WD17 1TX</strong></p>
      <p style={{ marginBottom: "12px" }}><strong>For: {vendor.company_name}</strong></p>
      <hr style={{ border: "none", borderTop: "1px solid #000", marginBottom: "12px" }} />

      <p style={{ marginBottom: "10px" }}><strong>Dear Vendor,</strong></p>
      <p style={{ marginBottom: "10px", lineHeight: "1.7" }}>
        As it has been agreed, this document serves as an exception for all vendors shipping{" "}
        <u>REPEAT ORDERS</u> and can be uploaded on the portal to replace the{" "}
        <strong>'FDC' FOOD DETAIL CHECKLIST</strong>, upon receipt of the Collection Date from the carrier.
        This exception is valid for {po.po_prefix} Prefix: <strong>{vendor.company_name}</strong>.
      </p>
      <p style={{ marginBottom: "16px" }}>
        Please upload this document when booking your POs as your "Food Detail Checklist".
      </p>

      <table style={{ width: "60%", margin: "0 auto 24px auto", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ border: "1px solid #000", padding: "8px 12px", textAlign: "center", fontWeight: "bold" }}>VENDOR STYLE CHECKED</th>
            <th style={{ border: "1px solid #000", padding: "8px 12px", textAlign: "center", fontWeight: "bold" }}>VENDOR STYLE TO BE SHIPPED</th>
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? items.map((item, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #000", padding: "6px 12px", textAlign: "center" }}>{item.item_number || item.vendor_style || ""}</td>
              <td style={{ border: "1px solid #000", padding: "6px 12px", textAlign: "center" }}>YES</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={2} style={{ border: "1px solid #000", padding: "8px", textAlign: "center", color: "#999" }}>No items on this PO</td>
            </tr>
          )}
        </tbody>
      </table>

      <p style={{ marginBottom: "4px" }}>Kind regards,</p>
      <p style={{ marginBottom: "32px" }}>TJX Europe Logistics Team</p>

      <div style={{ marginTop: "20px" }}>
        <img src="https://media.base44.com/images/public/69b77fe17f63d9da1603f490/16f51c542_FooterTJX1.png" alt="TJX Footer" style={{ width: "100%", height: "auto" }} />
      </div>
    </div>
  );
}

// ============================
// MAIN EXPORT
// ============================
export default function FoodChecklistDoc({ po, vendor, products }) {
  const items = po.items || [];

  const getProduct = (item) =>
    products.find(p =>
      p.id === item.product_id ||
      (item.item_number && p.item_number === item.item_number) ||
      (item.vendor_style && p.vendor_style === item.vendor_style) ||
      (item.vendor_style && p.item_number === item.vendor_style)
    );

  return (
    <div>
      {items.map((item, idx) => {
        const prod = getProduct(item);

        return (
          <div key={idx} style={{ pageBreakAfter: "always" }}>
            <FDCTab1 po={po} vendor={vendor} item={item} prod={prod} />
            <FDCForm1 po={po} item={item} prod={prod} />
            {po.po_prefix === "55" && (
              <FDCForm2 po={po} vendor={vendor} item={item} prod={prod} />
            )}
          </div>
        );
      })}
    </div>
  );
}