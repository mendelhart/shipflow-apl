// Ship-to addresses keyed by PO prefix (50 = UK, 55 = Germany)
export const SHIP_TO = {
  "50": "TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW",
  "55": "TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany",
};

// Opens a popup window with 4×6 pallet labels (one per pallet, sequential
// across all selected POs) and a Print button.
export function openPalletLabelsWindow({ selectedPOObjects, vendors, fields, getPalletCount }) {
  const grandTotal = selectedPOObjects.reduce((s, po) => s + getPalletCount(po), 0);

  let counter = 1;
  const labelsHtml = selectedPOObjects.flatMap(po => {
    const v = vendors.find(vv => vv.id === po.vendor_id);
    const shipToRaw = SHIP_TO[po.po_prefix] || SHIP_TO["50"];
    const shipToHtml = shipToRaw.replace(/\n/g, "<br/>");
    const items = po.items || [];
    const totalCartons = items.reduce((s, i) => s + (parseInt(i.num_cartons) || 0), 0);
    const totalUnits = items.reduce((s, i) => s + (parseInt(i.total_units) || 0), 0);
    const count = getPalletCount(po);
    const poPallets = count;
    const poNumber = po.po_prefix ? `${po.po_prefix}-${po.po_number}` : po.po_number || "";
    const vendorAddr = [v?.address_line1, v?.city, v?.country].filter(Boolean).join(", ");

    return Array.from({ length: count }, () => {
      const n = counter++;
      return `
        <div class="label">
          <div class="pallet-num">PALLET ${n} of ${grandTotal}</div>

          <div class="two-col" style="flex:0 0 auto">
            <div class="box">
              <div class="box-label">FROM:</div>
              <div class="val bold">${v?.company_name || "—"}</div>
              <div class="val">${vendorAddr}</div>
            </div>
            <div class="box">
              <div class="box-label">SHIP TO:</div>
              <div class="val bold">${shipToHtml}</div>
            </div>
          </div>

          <div class="box po-box" style="flex:0 0 auto">
            <div class="box-label">PO NUMBER</div>
            <div class="po-val">${poNumber}</div>
          </div>

          <div class="two-col" style="flex:0 0 auto">
            <div class="box">
              <div class="box-label">DEPT NO</div>
              <div class="val bold">${po.dept_number || "—"}</div>
            </div>
            <div class="box">
              <div class="box-label">CONTAINER</div>
              <div class="val">${fields.containerNumber || "—"}</div>
            </div>
            <div class="box">
              <div class="box-label">TOTAL CARTONS</div>
              <div class="val bold">${totalCartons}</div>
            </div>
            <div class="box">
              <div class="box-label">TOTAL UNITS</div>
              <div class="val bold">${totalUnits || "—"}</div>
            </div>
            <div class="box">
              <div class="box-label">PALLETS (THIS PO)</div>
              <div class="val bold">${poPallets} of ${grandTotal} total</div>
            </div>
            <div class="box">
              <div class="box-label">GROSS WEIGHT</div>
              <div class="val">${po.total_gross_weight_kg ? po.total_gross_weight_kg + " kg" : "—"}</div>
            </div>
            <div class="box full-col">
              <div class="box-label">CBM</div>
              <div class="val">${po.total_cbm ? po.total_cbm + " M³" : "—"}</div>
            </div>
          </div>

          <div class="booking-bar" style="flex:0 0 auto">
            <span>APLL: <strong>${fields.apllBookingNumber || "—"}</strong></span>
            <span>SEAL: <strong>${fields.sealNumber || "—"}</strong></span>
            <span>${fields.containerSize || ""}</span>
          </div>

          <div class="footer">Pallets must be Heat Treated or Fumigated per ISPM 15 | ISO 17712 seal required</div>
        </div>`;
    });
  }).join("");

  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) { alert("Please allow popups to print pallet labels."); return; }
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Pallet Labels – ${selectedPOObjects.map(p => p.po_number).join(", ")}</title>
<style>
@page { size: 4in 6in; margin: 0; }
* { box-sizing: border-box; }
body { margin:0; background:#fff; font-family:Arial,sans-serif; font-size:11px; color:#000; }

.label {
  width: 4in; height: 6in;
  padding: .18in .18in .14in;
  page-break-after: always; break-after: page;
  display: flex; flex-direction: column; gap: 4px;
  overflow: hidden;
}

.pallet-num {
  text-align: center; font-weight: bold; font-size: 22px;
  border: 3px solid #000; padding: 5px 4px; flex-shrink: 0;
  letter-spacing: 1px;
}

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
.box { border: 1.5px solid #000; padding: 4px 6px; }
.box-label { font-weight: bold; font-size: 8.5px; text-transform: uppercase; margin-bottom: 1px; color: #333; }
.val { font-size: 11px; line-height: 1.3; }
.bold { font-weight: bold; }
.full-col { grid-column: 1 / -1; }

.po-box { border: 1.5px solid #000; padding: 4px 6px; }
.po-val { font-size: 20px; font-weight: bold; letter-spacing: 0.5px; }

.booking-bar {
  display: flex; gap: 8px; align-items: center;
  border: 1.5px solid #000; padding: 4px 6px;
  font-size: 10px; flex-wrap: wrap;
}

.footer {
  margin-top: auto; font-size: 9px; font-weight: bold;
  border-top: 2px solid #000; padding-top: 4px; color: #000;
  flex-shrink: 0;
}

@media screen {
  body { background: #888; display: flex; flex-direction: column; align-items: center; padding: 60px 20px 20px; gap: 24px; }
  .label { background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  .print-bar {
    position: fixed; top: 0; left: 0; right: 0;
    background: #1e293b; color: #fff;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; font-family: Arial; font-size: 13px; z-index: 9999;
  }
  .print-btn {
    background: #f59e0b; color: #000; border: none; border-radius: 6px;
    padding: 8px 20px; font-weight: bold; font-size: 13px; cursor: pointer;
  }
  .print-btn:hover { background: #d97706; }
}
@media print { .print-bar { display: none !important; } }
</style></head>
<body>
<div class="print-bar">
  <span>🏷 ${grandTotal} Pallet Label${grandTotal !== 1 ? "s" : ""} — ${selectedPOObjects.map(p => p.po_number).join(", ")}</span>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF (4×6)</button>
</div>
${labelsHtml}
</body></html>`);
  win.document.close();
}