import { format } from "date-fns";
import { formatPoNumber } from "@/utils/poNumber";

// ─────────────────────────────────────────────────────────
// Builds one SCLP document as a standalone HTML string (used
// by the popup PDF / print window). Mirrors SCLPDoc.jsx.
// ─────────────────────────────────────────────────────────
export function buildSCLPHtml({ poList, vendors, shipmentInfo, palletOverrides, containerLabel, itemOverrides, combinedTable = true, palletCount }) {
  const s = (val, fallback = "—") => val || fallback;

  const primaryPO = poList[0];
  const primaryVendor = vendors.find(v => v.id === primaryPO?.vendor_id);
  const vendorPhone = primaryVendor?.phone || "";
  const vendorFax   = primaryVendor?.fax   || "";
  const vendorEmail = primaryVendor?.email || "";
  const vendorAddr  = primaryVendor
    ? [primaryVendor.address_line1, primaryVendor.city, primaryVendor.state_province, primaryVendor.postal_code]
        .filter(Boolean).join(", ")
    : "";

  let rows = [];
  if (itemOverrides) {
    rows = itemOverrides.map(item => ({ po: item.po || primaryPO, item }));
  } else if (combinedTable) {
    rows = poList.flatMap(po => (po.items || []).map(item => ({ po, item })));
  } else {
    rows = (poList[0]?.items || []).map(item => ({ po: poList[0], item }));
  }

  const totalCartons = rows.reduce((s, r) => s + (parseInt(r.item.num_cartons) || 0), 0);
  const totalUnits   = rows.reduce((s, r) => s + (parseFloat(r.item.total_units) || 0), 0);
  const totalGross   = rows.reduce((s, r) => {
    const c = parseInt(r.item.num_cartons) || 0;
    return s + c * (parseFloat(r.item.net_weight_kg) || 0);
  }, 0);
  const totalCbm     = rows.reduce((s, r) => {
    const c = parseInt(r.item.num_cartons) || 0;
    return s + c * (parseFloat(r.item.cbm) || 0);
  }, 0);
  const totalPallets = (palletCount !== undefined && palletCount !== "")
    ? (parseInt(palletCount) || 0)
    : poList.reduce((sum, po) => {
        const ov = palletOverrides?.[po.id];
        return sum + (ov !== undefined && ov !== "" ? parseInt(ov) : (parseInt(po.total_pallets) || 0));
      }, 0);

  let deliveryDateFormatted = "—";
  if (shipmentInfo.actualDeliveryDate) {
    try { deliveryDateFormatted = format(new Date(shipmentInfo.actualDeliveryDate), "MMM dd, yyyy"); } catch {}
  }

  const poNumbers = poList.map(p => formatPoNumber(p)).join(" | ");

  const itemRows = rows.map(({ po, item }) => {
    const cartons = parseInt(item.num_cartons) || 0;
    const cbm     = (cartons * (parseFloat(item.cbm) || 0)).toFixed(2);
    const weight  = Math.round(cartons * (parseFloat(item.net_weight_kg) || 0));
    return `
      <tr>
        <td>${formatPoNumber(po)}</td>
        <td>${item.item_number || ""}</td>
        <td>Slim Syrups ${item.description || ""}</td>
        <td class="center">${cartons}</td>
        <td class="center">${item.total_units || ""}</td>
        <td class="center">${cbm}</td>
        <td class="center">${weight}</td>
      </tr>`;
  }).join("");

  const palletBreakdown = (poList.length > 1 && palletCount === undefined)
    ? `(${poList.map(po => {
        const ov = palletOverrides?.[po.id];
        const val = ov !== undefined && ov !== "" ? parseInt(ov) : (po.total_pallets || 0);
        return `${formatPoNumber(po)}: ${val}`;
      }).join(" | ")})`
    : "";

  return `
    <div class="sclp-doc">
      <div class="title-block">
        <div class="main-title">Security Container Load Plan (SCLP)</div>
        ${containerLabel ? `<div class="container-label">${containerLabel}</div>` : ""}
        <div class="po-list">PO(s): ${poNumbers}</div>
      </div>

      <div class="step-label">STEP #1 SHIPPER'S REQUEST FOR FACTORY LOAD CONTAINER(S):</div>
      <table>
        <tr>
          <td><strong>Shipper:</strong> ${s(primaryVendor?.company_name)}</td>
          <td><strong>Phone:</strong> ${s(vendorPhone)}</td>
          <td><strong>Agent:</strong> Morris Hart</td>
        </tr>
        <tr>
          <td><strong>Address:</strong> ${s(vendorAddr)}</td>
          <td><strong>Fax:</strong> ${s(vendorFax)}</td>
          <td><strong>Email:</strong> ${s(vendorEmail)}</td>
        </tr>
      </table>

      <div class="step-label">STEP #2 SHIPMENT DETAILS:</div>
      <table>
        <tr>
          <td width="50%"><strong>Load Type:</strong> ${s(shipmentInfo.loadType)}</td>
          <td><strong>Container Size:</strong> ${s(shipmentInfo.containerSize)}</td>
        </tr>
        <tr>
          <td><strong>Container #:</strong> ${s(shipmentInfo.containerNumber)}</td>
          <td><strong>Seal #:</strong> ${s(shipmentInfo.sealNumber)}</td>
        </tr>
        <tr>
          <td><strong>APLL Booking #:</strong> ${s(shipmentInfo.apllBookingNumber)}</td>
          <td><strong>Port of Loading:</strong> ${s(shipmentInfo.portOfLoading)}</td>
        </tr>
        <tr>
          <td><strong>Vessel Name:</strong> ${s(shipmentInfo.vesselName)}</td>
          <td><strong>Voyage #:</strong> ${s(shipmentInfo.voyageNumber)}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>Actual Delivery Date to Port:</strong> ${deliveryDateFormatted}</td>
        </tr>
      </table>

      <div class="step-label">STEP #3 RECORD ORDERS AS LOADED:</div>
      <table>
        <thead>
          <tr class="thead-row">
            <th>PO</th><th>Style</th><th>Description</th>
            <th class="center">Cartons</th><th class="center">Units</th>
            <th class="center">CBM</th><th class="center">Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr class="totals-row">
            <td colspan="3" style="text-align:right">TOTAL</td>
            <td class="center">${totalCartons}</td>
            <td class="center">${totalUnits}</td>
            <td class="center">${totalCbm.toFixed(2)}</td>
            <td class="center">${Math.round(totalGross)}</td>
          </tr>
        </tbody>
      </table>

      ${totalPallets > 0 ? `
      <table class="pallets-table">
        <tr>
          <td class="pallets-label">Total Pallets:</td>
          <td class="pallets-val">${totalPallets}</td>
          ${palletBreakdown ? `<td class="pallets-breakdown">${palletBreakdown}</td>` : ""}
        </tr>
      </table>` : ""}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────
// Opens a popup window with the SCLP HTML and a Print +
// html2canvas/jsPDF "Download PDF" toolbar.
// `multi` = bodyHtml already contains <div class="sclp-page"> blocks.
// ─────────────────────────────────────────────────────────
export function openSCLPWindow({ title, bodyHtml, multi = false }) {
  const win = window.open("", "_blank", "width=960,height=820");
  if (!win) { alert("Please allow popups to download the SCLP."); return; }

  const pageDivs = multi
    ? bodyHtml
    : `<div class="sclp-page" id="page-0">${bodyHtml}</div>`;

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; background: #94a3b8; color: #000; padding-top: 60px; }

  .print-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #1e293b; color: #fff;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 20px; font-family: Arial; font-size: 13px;
    gap: 10px;
  }
  .bar-btns { display: flex; gap: 8px; align-items: center; }
  .btn {
    border: none; border-radius: 6px;
    padding: 8px 18px; font-weight: bold; font-size: 13px; cursor: pointer;
    display: flex; align-items: center; gap: 6px;
  }
  .btn-pdf   { background: #3b82f6; color: #fff; }
  .btn-pdf:hover { background: #2563eb; }
  .btn-print { background: #475569; color: #fff; }
  .btn-print:hover { background: #334155; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  #status-msg { font-size: 12px; color: #94a3b8; min-width: 140px; }

  .sclp-page {
    width: 794px;
    background: #fff;
    margin: 0 auto 32px;
    box-shadow: 0 2px 12px rgba(0,0,0,.25);
    overflow: hidden;
  }

  .sclp-doc { width: 794px; padding: 24px 28px; }
  .title-block  { text-align: center; margin-bottom: 10px; }
  .main-title   { font-size: 17px; font-weight: bold; }
  .container-label { font-size: 12px; color: #c00; font-weight: bold; margin-top: 2px; }
  .po-list      { font-size: 10px; color: #555; margin-top: 3px; }
  .step-label   { font-weight: bold; margin: 8px 0 4px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 11px; }
  th, td { border: 1px solid #000; padding: 3px 5px; }
  .thead-row { background: #eee; }
  .thead-row th { font-weight: bold; }
  .totals-row { font-weight: bold; background: #f5f5f5; }
  .center { text-align: center; }
  .pallets-table { width: auto; margin-bottom: 6px; }
  .pallets-label { font-weight: bold; padding: 3px 8px; }
  .pallets-val   { padding: 3px 12px; }
  .pallets-breakdown { font-size: 10px; color: #555; padding: 3px 8px; }

  @media print {
    @page { size: A4 portrait; margin: 0; }
    body  { background: #fff; padding-top: 0; }
    .print-bar { display: none !important; }
    .sclp-page { box-shadow: none; margin: 0; page-break-after: always; break-after: page; }
    .sclp-page:last-child { page-break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="print-bar">
    <span>📄 ${title.replace(/_/g, " ")}</span>
    <div class="bar-btns">
      <span id="status-msg"></span>
      <button class="btn btn-pdf" id="dl-btn" onclick="downloadPDF()">⬇ Download PDF</button>
      <button class="btn btn-print" onclick="window.print()">🖨 Print</button>
    </div>
  </div>

  <div id="pages-container">
    ${pageDivs}
  </div>

  <script>
    var PDF_TITLE = "${title}";

    async function downloadPDF() {
      var btn = document.getElementById('dl-btn');
      var msg = document.getElementById('status-msg');
      btn.disabled = true;
      btn.textContent = '⏳ Generating…';

      try {
        var { jsPDF } = window.jspdf;
        var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pages = document.querySelectorAll('.sclp-page');
        var A4_W_MM = 210, A4_H_MM = 297;

        for (var i = 0; i < pages.length; i++) {
          msg.textContent = 'Page ' + (i + 1) + ' of ' + pages.length + '…';
          var page = pages[i];

          var canvas = await html2canvas(page, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            width: 794,
            windowWidth: 794,
          });

          var imgData = canvas.toDataURL('image/jpeg', 0.97);
          var canvasW = canvas.width;
          var canvasH = canvas.height;
          var imgH_mm = (canvasH / canvasW) * A4_W_MM;

          if (i > 0) pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, 0, A4_W_MM, Math.min(imgH_mm, A4_H_MM));
        }

        pdf.save(PDF_TITLE + '.pdf');
        msg.textContent = '✅ Downloaded!';
        setTimeout(function() { msg.textContent = ''; }, 3000);
      } catch(err) {
        console.error('PDF generation failed:', err);
        msg.textContent = '❌ Failed – try Print instead';
      } finally {
        btn.disabled = false;
        btn.textContent = '⬇ Download PDF';
      }
    }
  <\/script>
</body></html>`);
  win.document.close();
}