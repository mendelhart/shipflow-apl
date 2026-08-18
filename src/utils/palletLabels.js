import { shipToFor, KNOWN_PREFIXES, labelPoNumber } from '@/domain/labelContent';
import { shipmentTotals } from '@/domain/shipmentTotals';

/**
 * 4x6 pallet labels.
 *
 * WHAT THIS LABEL IS FOR, AND WHEN IT EXISTS
 * Pallet labels are produced after every carton has been stickered and before a
 * container has been assigned. Anything that only becomes known when the
 * container is booked and sealed therefore cannot appear here.
 *
 * It used to print four such fields — CONTAINER, SEAL, container size and the
 * APLL booking number — all sourced from the SCLP screen's container form. At
 * the moment these labels are made those values are empty, so every pallet in
 * the warehouse carried "CONTAINER —" and "SEAL —". If someone filled the SCLP
 * form first and reprinted, the labels would then assert a container assignment
 * that had not happened.
 *
 * Numbering is per purchase order. It used to run 1..N across every PO selected
 * on the SCLP screen, which presupposes knowing what ships together — the very
 * decision that has not been made yet. "PALLET 2 of 6" against a PO number is
 * true the moment the pallet is wrapped and stays true afterwards.
 *
 * With those four fields gone the pallet number is set much larger — it is the
 * thing someone reads across a warehouse aisle.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const nbsp = (v) => (v === '' || v === null || v === undefined ? '&mdash;' : esc(v));

/**
 * @param {object[]} selectedPOObjects POs to label
 * @param {object[]} vendors           vendor records, for the FROM address
 * @param {(po:object)=>number} getPalletCount how many pallets this PO makes
 */
export function openPalletLabelsWindow({ selectedPOObjects, vendors, getPalletCount }) {
  const pos = selectedPOObjects || [];

  const unknownPrefix = pos.filter((po) => !shipToFor(po));
  if (unknownPrefix.length) {
    alert(
      `No ship-to address for PO prefix "${unknownPrefix[0].po_prefix ?? ''}" ` +
      `(known prefixes: ${KNOWN_PREFIXES.join(', ')}). Fix the PO prefix before printing — ` +
      `these labels used to default to the London processing centre.`
    );
    return;
  }

  const grandTotal = pos.reduce((s, po) => s + getPalletCount(po), 0);

  const labelsHtml = pos
    .flatMap((po) => {
      const v = (vendors || []).find((vv) => vv.id === po.vendor_id);
      const shipToHtml = shipToFor(po).split('\n').map(esc).join('<br/>');
      const { cartons, units, grossKg, cbm } = shipmentTotals(po.items || []);
      const count = getPalletCount(po);
      const vendorAddr = [v?.address_line1, v?.city, v?.country].filter(Boolean).join(', ');

      return Array.from({ length: count }, (_, i) => `
        <div class="label">
          <div class="pallet-num">PALLET ${i + 1} of ${count}</div>

          <div class="box po-box">
            <div class="box-label">PO NUMBER</div>
            <div class="po-val">${esc(labelPoNumber(po))}</div>
          </div>

          <div class="two-col">
            <div class="box">
              <div class="box-label">FROM:</div>
              <div class="val bold">${nbsp(v?.company_name)}</div>
              <div class="val">${esc(vendorAddr)}</div>
            </div>
            <div class="box">
              <div class="box-label">SHIP TO:</div>
              <div class="val bold">${shipToHtml}</div>
            </div>
          </div>

          <div class="two-col">
            <div class="box">
              <div class="box-label">DEPT NO</div>
              <div class="val bold">${nbsp(po.dept_number)}</div>
            </div>
            <div class="box">
              <div class="box-label">PALLETS ON THIS PO</div>
              <div class="val bold">${count}</div>
            </div>
            <div class="box">
              <div class="box-label">TOTAL CARTONS</div>
              <div class="val bold">${cartons || '&mdash;'}</div>
            </div>
            <div class="box">
              <div class="box-label">TOTAL UNITS</div>
              <div class="val bold">${units || '&mdash;'}</div>
            </div>
            <div class="box">
              <div class="box-label">GROSS WEIGHT</div>
              <div class="val">${grossKg ? `${grossKg.toFixed(2)} kg` : '&mdash;'}</div>
            </div>
            <div class="box">
              <div class="box-label">CBM</div>
              <div class="val">${cbm ? `${cbm.toFixed(3)} M³` : '&mdash;'}</div>
            </div>
          </div>

          <div class="footer">Pallets must be Heat Treated or Fumigated per ISPM 15</div>
        </div>`);
    })
    .join('');

  const title = pos.map((p) => labelPoNumber(p)).join(', ');

  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) { alert('Please allow popups to print pallet labels.'); return; }
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Pallet Labels – ${esc(title)}</title>
<style>
@page { size: 4in 6in; margin: 0; }
* { box-sizing: border-box; }
body { margin:0; background:#fff; font-family:Arial,sans-serif; font-size:11px; color:#000; }

.label {
  width: 4in; height: 6in;
  padding: .18in .18in .14in;
  page-break-after: always; break-after: page;
  display: flex; flex-direction: column; gap: 5px;
  overflow: hidden;
}

.pallet-num {
  text-align: center; font-weight: bold; font-size: 30px;
  border: 3px solid #000; padding: 8px 4px; flex-shrink: 0;
  letter-spacing: 1px;
}

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.box { border: 1.5px solid #000; padding: 5px 7px; }
.box-label { font-weight: bold; font-size: 9px; text-transform: uppercase; margin-bottom: 2px; color: #333; }
.val { font-size: 12px; line-height: 1.3; }
.bold { font-weight: bold; }

.po-box { flex: 0 0 auto; }
.po-val { font-size: 26px; font-weight: bold; letter-spacing: 0.5px; }

.footer {
  margin-top: auto; font-size: 9px; font-weight: bold;
  border-top: 2px solid #000; padding-top: 5px; color: #000;
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
  <span>${grandTotal} pallet label${grandTotal !== 1 ? 's' : ''} — ${esc(title)}</span>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF (4×6)</button>
</div>
${labelsHtml}
</body></html>`);
  win.document.close();
}
