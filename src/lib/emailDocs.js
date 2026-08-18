// Shared PDF generation + email-packaging utilities for the APL Logistics
// and TJX Europe document-email dialogs. All PDFs are real vector PDFs built
// with jsPDF + jspdf-autotable (no html2canvas, no Base44 credits). Email
// delivery uses either the Base44 backend function (sendInvoiceEmail) or a
// client-side .eml / zip download for desktop mail clients (the only path
// that works while Base44 integration credits / backend functions are
// unavailable).

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { format } from "date-fns";
import { formatPoNumber } from "@/utils/poNumber";
import { STATUS_ORDER, bumpStatus } from "@/domain/poStatus";
import { HEADER_IMG, FOOTER_IMG, HEADER_FALLBACK, FOOTER_FALLBACK, loadBrandImage } from "@/domain/brandAssets";
import { encodeHeader, encodeAddressHeader, encodeTextBody } from "@/lib/mimeHeaders";

const PAGE = { w: 612, h: 792, margin: 36 }; // US Letter, points
const CONTENT_W = PAGE.w - PAGE.margin * 2;

const INVOICE_ADDRESSES = {
  "50": {
    delivery: "TJX UK Processing Centre\nC/O APL Logistics\nLondon E15 2GW",
    buyer: "TJX UK\n73 Clarendon Road, Watford, Herts\nWD17 1TX United Kingdom",
  },
  "55": {
    delivery: "TJX UK\nc/o TJX Distribution Ltd & Co KG\nBen-Cammarata Strasse 1\n50126 Bergheim, Germany",
    buyer: "TJX UK\n73 Clarendon Road, Watford, Herts\nWD17 1TX United Kingdom",
  },
};

const FDC_DEST = { "50": "United Kingdom", "55": "Germany" };

// Served from our own /public now — see @/domain/brandAssets. These used to be
// hot-linked from the platform this app was migrated off.

const TABLE_BASE_STYLES = {
  styles: { fontSize: 8, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.5, textColor: [0, 0, 0], valign: "middle" },
  headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold", halign: "center", fontSize: 8 },
  footStyles: { fillColor: [249, 249, 249], textColor: [0, 0, 0], fontStyle: "bold" },
  theme: "grid",
  margin: { left: PAGE.margin, right: PAGE.margin },
};

const SAFE_BATCH_BYTES = 23 * 1024 * 1024; // ~23MB per email, headroom under Gmail/Outlook's 25MB cap


// ---- signature font (Alex Brush, a Google Font) -----------------------------
const SIGNATURE_FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/alexbrush/AlexBrush-Regular.ttf";
let signatureFontPromise = null;

function uint8ToBase64ForFont(bytes) {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function getSignatureFontBase64() {
  if (!signatureFontPromise) {
    signatureFontPromise = (async () => {
      const resp = await fetch(SIGNATURE_FONT_URL);
      if (!resp.ok) throw new Error(`Signature font fetch failed: ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return uint8ToBase64ForFont(bytes);
    })().catch((err) => {
      signatureFontPromise = null;
      throw err;
    });
  }
  return signatureFontPromise;
}

async function registerSignatureFont(pdf) {
  try {
    const base64 = await getSignatureFontBase64();
    pdf.addFileToVFS("AlexBrush-Regular.ttf", base64);
    pdf.addFont("AlexBrush-Regular.ttf", "AlexBrush", "normal");
    return true;
  } catch (err) {
    console.error("Signature font unavailable, falling back to italic Helvetica:", err);
    return false;
  }
}

// ---- low-level drawing helpers ---------------------------------------------

function newPdf() {
  return new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
}

function boxHeight(lines, padTop = 14, padBottom = 8) {
  let h = padTop;
  for (const line of lines) h += line.lineHeight || 10;
  return h + padBottom;
}

function drawBox(pdf, x, y, w, h, lines) {
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.75);
  pdf.rect(x, y, w, h);
  let cy = y + 12;
  for (const line of lines) {
    pdf.setFont("helvetica", line.bold ? "bold" : "normal");
    pdf.setFontSize(line.size || 8);
    pdf.text(line.text, x + 6, cy);
    cy += line.lineHeight || 10;
  }
}

function drawBoxRow(pdf, x, y, width, linesArr) {
  const colW = width / linesArr.length;
  const h = Math.max(...linesArr.map((l) => boxHeight(l)));
  linesArr.forEach((lines, i) => drawBox(pdf, x + i * colW, y, colW, h, lines));
  return y + h;
}

function addressLinesFor(addr) {
  return (addr || "").split("\n").filter(Boolean).map((text) => ({ text }));
}

async function fetchImageDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function vendorAddressLines(vendor) {
  return [
    vendor.company_name,
    vendor.address_line1,
    vendor.address_line2,
    vendor.city && `${vendor.city}${vendor.state_province ? ", " + vendor.state_province : ""}`,
    vendor.postal_code,
    vendor.country,
  ].filter(Boolean);
}

// UK Origin Declaration: reflects the actual set of countries of origin
// present on this specific invoice's items.
function getOriginDeclarationText(items) {
  // A blank country of origin used to become "USA" silently — inside a signed
  // preferential-origin declaration, for a Blainville, Quebec exporter. A false
  // origin claim on a customs document is not a default worth having.
  const missing = (items || []).filter(i => !String(i.country_of_origin || "").trim());
  if (missing.length) {
    throw new Error(
      `Country of origin is blank on ${missing.map(i => i.item_number || "an item").join(", ")}. ` +
      `Fill it in before generating documents — the origin declaration is signed.`
    );
  }
  const origins = [...new Set((items || []).map(i => i.country_of_origin.trim()).filter(Boolean))];
  if (origins.length === 0) return "USA";
  if (origins.length === 1) return origins[0];
  return origins.slice(0, -1).join(", ") + " and " + origins[origins.length - 1];
}

// ---- Commercial Invoice -----------------------------------------------------

export async function buildCommercialInvoicePdf({ po, vendor, customsId, settingsExporterName, settingsExporterTitle }) {
  const pdf = newPdf();
  const addr = INVOICE_ADDRESSES[po.po_prefix] || INVOICE_ADDRESSES["50"];
  const items = po.items || [];
  const cur = po.currency || "CAD";
  // Was applied to every row regardless of the item's own classification, so
  // this invoice and the Food Data Checklist beside it declared different
  // tariff codes for the same goods.
  const HS_FALLBACK = "2106.90.99.98";

  const hasSignatureFont = await registerSignatureFont(pdf);
  const exporterName = po.exporter_name || settingsExporterName || "Mendel Hart";
  const exporterTitle = po.exporter_title || settingsExporterTitle || "Business Development Director";
  const printDate = format(new Date(), "dd/MM/yyyy");
  const placeAndDate = `${[vendor.city, vendor.state_province, vendor.country].filter(Boolean).join(", ")}${vendor.city ? ", " : ""}${printDate}`;

  const drawSignature = (x, yPos, size = 18) => {
    if (hasSignatureFont) { pdf.setFont("AlexBrush", "normal"); pdf.setFontSize(size); }
    else { pdf.setFont("helvetica", "bolditalic"); pdf.setFontSize(size * 0.6); }
    pdf.setTextColor(30, 60, 200);
    pdf.text(exporterName, x, yPos);
    pdf.setTextColor(0, 0, 0);
  };

  const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
  const totalUnits = items.reduce((s, i) => s + (parseFloat(i.total_units) || 0), 0);
  const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
  const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
  const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);
  const totalValue = items.reduce((s, i) => s + (parseFloat(i.total_units) || 0) * (parseFloat(i.unit_price) || 0), 0);

  let y = PAGE.margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("COMMERCIAL INVOICE", PAGE.w / 2, y + 4, { align: "center" });
  y += 26;

  y = drawBoxRow(pdf, PAGE.margin, y, CONTENT_W, [
    [{ text: "Vendor (Name and Address)", bold: true }, ...vendorAddressLines(vendor).map((text) => ({ text }))],
    [{ text: "Buyer / Consignee:", bold: true }, ...addressLinesFor(addr.buyer)],
  ]);

  y = drawBoxRow(pdf, PAGE.margin, y, CONTENT_W, [
    [
      { text: `Invoice Number: ${po.invoice_number || "_____________"}` },
      { text: `Invoice Date: ${po.invoice_date ? format(new Date(po.invoice_date), "dd/MM/yyyy") : "_____________"}` },
      { text: `PO Number: ${formatPoNumber(po)}` },
      { text: `Dept No: ${po.dept_number || ""}   Freight: ${po.freight_terms || ""}   Currency: ${cur}` },
    ],
    [{ text: "Delivery Address:", bold: true }, ...addressLinesFor(addr.delivery)],
  ]);

  y += 10;

  autoTable(pdf, {
    ...TABLE_BASE_STYLES,
    startY: y,
    head: [["Item #", "Vendor Style", "Description", "HS Code", "COO", "Size", "Units/Ctn", "# Ctns", "Total Units", `Unit Price\n(${cur})`, `Total Value\n(${cur})`]],
    body: items.map((item) => [
      item.item_number || "",
      item.vendor_style || "",
      item.description || "",
      item.hs_code || HS_FALLBACK,
      item.country_of_origin || "USA",
      item.size || "",
      String(item.units_per_carton ?? ""),
      String(item.num_cartons ?? ""),
      String(item.total_units ?? ""),
      (parseFloat(item.unit_price) || 0).toFixed(2),
      ((parseFloat(item.total_units) || 0) * (parseFloat(item.unit_price) || 0)).toFixed(2),
    ]),
    foot: [[
      { content: "TOTALS", colSpan: 7, styles: { halign: "right" } },
      { content: String(totalCartons), styles: { halign: "center" } },
      { content: String(totalUnits), styles: { halign: "center" } },
      "",
      { content: `${cur} ${totalValue.toFixed(2)}`, styles: { halign: "right" } },
    ]],
    columnStyles: {
      6: { halign: "center" }, 7: { halign: "center" }, 8: { halign: "center" },
      9: { halign: "right" }, 10: { halign: "right" },
    },
  });

  y = pdf.lastAutoTable.finalY + 10;

  const summaryRowY = y;
  y = drawBoxRow(pdf, PAGE.margin, y, CONTENT_W, [
    [
      { text: `Total Cartons: ${totalCartons}` },
      { text: `Total Gross Weight: ${totalGross.toFixed(2)} kg` },
      { text: `Total Net Weight: ${totalNet.toFixed(2)} kg` },
      { text: `Total Volume: ${totalCbm.toFixed(6)} M³` },
    ],
    [
      { text: "Total Invoice Value:", bold: true },
      { text: `${cur} ${totalValue.toFixed(2)}`, bold: true, size: 14, lineHeight: 18 },
    ],
    [
      { text: "Authorized Signature:", bold: true },
    ],
  ]);
  {
    const colW = CONTENT_W / 3;
    const sigX = PAGE.margin + colW * 2 + 6;
    drawSignature(sigX, summaryRowY + 30, 16);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(`Date: ${printDate}`, sigX, summaryRowY + 44);
  }

  if (po.notes) {
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.75);
    const noteH = 28;
    pdf.rect(PAGE.margin, y + 4, CONTENT_W, noteH);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Notes:", PAGE.margin + 6, y + 18);
    pdf.setFont("helvetica", "normal");
    const noteLines = pdf.splitTextToSize(po.notes, CONTENT_W - 50);
    pdf.text(noteLines, PAGE.margin + 45, y + 18);
    y += noteH + 12;
  } else {
    y += 12;
  }

  // ---- Origin Declaration (UK/prefix "50" shipments only) ----
  if (po.po_prefix === "50") {
    const origin = getOriginDeclarationText(items);
    const declarationText = `The exporter of the products covered by this document (customs identification No. ${customsId || "785337692RM0003"}) declares that, except where otherwise clearly indicated, these products are of ${origin} preferential origin.`;
    const declLines = pdf.splitTextToSize(declarationText, CONTENT_W);
    const sectionHeight = 24 + declLines.length * 11 + 56 + 40 + 34;

    if (y + sectionHeight > PAGE.h - PAGE.margin) {
      pdf.addPage();
      y = PAGE.margin;
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("Origin Declaration", PAGE.margin, y);
    y += 14;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(declLines, PAGE.margin, y);
    y += declLines.length * 11 + 16;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(`Place and date: ${placeAndDate}`, PAGE.margin, y);

    pdf.setFont("helvetica", "normal");
    pdf.text("Name and signature of the exporter:", PAGE.margin + CONTENT_W / 2, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(exporterName, PAGE.margin + CONTENT_W / 2, y + 12);
    drawSignature(PAGE.margin + CONTENT_W / 2, y + 28, 16);
    y += 38;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("Manufacturer Name and Address (if different than Vendor):", PAGE.margin, y);
    y += 10;
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.75);
    pdf.line(PAGE.margin, y + 8, PAGE.margin + CONTENT_W, y + 8);
    y += 24;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("Responsible Party Information:", PAGE.margin, y);
    pdf.text("Signature", PAGE.margin + CONTENT_W / 2, y);
    drawSignature(PAGE.margin + CONTENT_W / 2, y + 14, 16);
    y += 28;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Name: ${exporterName}`, PAGE.margin, y);
    pdf.text(`Tittle: ${exporterTitle}`, PAGE.margin + CONTENT_W / 2, y);
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}

// ---- Packing List -----------------------------------------------------------

export function buildPackingListPdf({ po, vendor }) {
  const pdf = newPdf();
  const addr = INVOICE_ADDRESSES[po.po_prefix] || INVOICE_ADDRESSES["50"];
  const items = po.items || [];

  const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
  const totalUnits = items.reduce((s, i) => s + (parseFloat(i.total_units) || 0), 0);
  const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
  const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
  const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);

  let y = PAGE.margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("PACKING LIST", PAGE.w / 2, y + 6, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(85, 85, 85);
  pdf.text("Page 1 of 1", PAGE.w / 2, y + 20, { align: "center" });
  pdf.setTextColor(0, 0, 0);
  y += 32;

  y = drawBoxRow(pdf, PAGE.margin, y, CONTENT_W, [
    [{ text: "Vendor Name & Address", bold: true }, ...vendorAddressLines(vendor).map((text) => ({ text }))],
    [{ text: "Buyer / Consignee:", bold: true }, ...addressLinesFor(addr.buyer)],
  ]);

  y = drawBoxRow(pdf, PAGE.margin, y, CONTENT_W, [
    [{ text: "Delivery Address:", bold: true }, ...addressLinesFor(addr.delivery)],
    [
      { text: `Invoice #: ${po.invoice_number || "_____________"}` },
      { text: `Invoice Date: ${po.invoice_date ? format(new Date(po.invoice_date), "dd/MM/yyyy") : "_____________"}` },
      { text: `PO Number: ${formatPoNumber(po)}` },
      { text: `Dept No: ${po.dept_number || ""}` },
      { text: "Country of Origin: (see below)" },
    ],
  ]);

  y += 10;

  autoTable(pdf, {
    ...TABLE_BASE_STYLES,
    startY: y,
    head: [["Item #", "Vendor Style", "Description", "Size", "COO", "Units/Ctn", "# Cartons", "Total Units", "Gross Wt (kg)", "Net Wt (kg)", "CBM"]],
    body: items.map((item) => [
      item.item_number || "",
      item.vendor_style || "",
      item.description || "",
      item.size || "",
      item.country_of_origin || "USA",
      String(item.units_per_carton ?? ""),
      String(item.num_cartons ?? ""),
      String(item.total_units ?? ""),
      ((parseFloat(item.num_cartons) || 0) * (parseFloat(item.gross_weight_kg) || 0)).toFixed(2),
      ((parseFloat(item.num_cartons) || 0) * (parseFloat(item.net_weight_kg) || 0)).toFixed(2),
      ((parseFloat(item.num_cartons) || 0) * (parseFloat(item.cbm) || 0)).toFixed(6),
    ]),
    foot: [[
      { content: "TOTALS", colSpan: 6, styles: { halign: "right" } },
      { content: String(totalCartons), styles: { halign: "center" } },
      { content: String(totalUnits), styles: { halign: "center" } },
      { content: totalGross.toFixed(2), styles: { halign: "right" } },
      { content: totalNet.toFixed(2), styles: { halign: "right" } },
      { content: totalCbm.toFixed(6), styles: { halign: "right" } },
    ]],
    columnStyles: {
      5: { halign: "center" }, 6: { halign: "center" }, 7: { halign: "center" },
      8: { halign: "right" }, 9: { halign: "right" }, 10: { halign: "right" },
    },
  });

  y = pdf.lastAutoTable.finalY + 10;

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.75);
  pdf.rect(PAGE.margin, y, CONTENT_W, 22);
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(9);
  pdf.text("A copy of this packing list must be securely attached on the carton at the moment of delivery.", PAGE.margin + 6, y + 14);

  return new Uint8Array(pdf.output("arraybuffer"));
}

// ---- Food Detail Checklist (FDC) --------------------------------------------

function fdcFormTitle(pdf, y, subtitle) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("FOOD DETAIL CHECKLIST", PAGE.w / 2, y, { align: "center" });
  pdf.setFontSize(9);
  pdf.text(subtitle, PAGE.w / 2, y + 13, { align: "center" });
  return y + 30;
}

export function buildFdcPdf({ po, vendor, products }) {
  const pdf = newPdf();
  const items = po.items || [];

  const getProduct = (item) =>
    products.find((p) =>
      p.id === item.product_id ||
      (item.item_number && p.item_number === item.item_number) ||
      (item.vendor_style && p.vendor_style === item.vendor_style) ||
      (item.vendor_style && p.item_number === item.vendor_style)
    );

  let firstPage = true;

  for (const item of items) {
    const prod = getProduct(item);
    const coo = prod?.fdc_consolidated_coo || item.country_of_origin || "USA";
    const numCartons = item.num_cartons ?? "";
    const unitsPerCarton = item.units_per_carton ?? prod?.units_per_carton ?? 6;
    const totalUnits = item.total_units ?? (numCartons !== "" ? Number(numCartons) * Number(unitsPerCarton) : "");

    const rows = [
      ["VENDOR NAME", vendor.company_name || ""],
      ["VENDOR STYLE #", item.vendor_style || item.item_number || ""],
      ["DETAILED PRODUCT DESCRIPTION", item.description || prod?.description || ""],
      ["CONSOLIDATED COUNTRY OF ORIGIN", coo],
      ["PRODUCT SIZE / VOLUME", item.size || prod?.size || "750ml"],
      ["UNITS PER CARTON", String(unitsPerCarton)],
      ["NUMBER OF CARTONS (FOR THIS PO)", String(numCartons)],
      ["TOTAL UNITS (FOR THIS PO)", String(totalUnits)],
      ["UPC / BARCODE", item.upc_code || prod?.upc_code || ""],
      ["HS CODE", item.hs_code || prod?.hs_code || ""],
      ["PO NUMBER", formatPoNumber(po)],
      ["DEPARTMENT NUMBER", po.dept_number || ""],
      ["DESTINATION", FDC_DEST[po.po_prefix] || "UK"],
      ["INVOICE NUMBER", po.invoice_number || ""],
      ["INVOICE DATE", po.invoice_date ? format(new Date(po.invoice_date), "dd/MM/yyyy") : ""],
      ["SHELF LIFE (days)", String(prod?.shelf_life_days || "")],
      ["STORAGE INSTRUCTIONS", prod?.storage_instructions || "Store at room temperature"],
    ];

    if (!firstPage) pdf.addPage();
    firstPage = false;
    let y = fdcFormTitle(pdf, PAGE.margin + 8, "Form 1");
    autoTable(pdf, {
      ...TABLE_BASE_STYLES,
      startY: y,
      body: rows.map(([label, val]) => [
        { content: label, styles: { fillColor: [242, 242, 242], fontStyle: "bold", cellWidth: CONTENT_W * 0.38 } },
        { content: val },
      ]),
      styles: { ...TABLE_BASE_STYLES.styles, fontSize: 9 },
    });

    pdf.addPage();
    y = fdcFormTitle(pdf, PAGE.margin + 8, "Form 2 – Ingredients");
    const ingList = prod?.fdc_ingredients?.length
      ? prod.fdc_ingredients
      : (prod?.ingredients || "").split(",").filter(Boolean).map((s) => ({ name: s.trim(), pct_by_weight: "", country_of_origin: "" }));
    const padCount = Math.max(0, 10 - ingList.length);
    const ingBody = ingList.map((ing) => [ing.name || "", ing.pct_by_weight || "", ing.country_of_origin || ""]);
    for (let i = 0; i < padCount; i++) ingBody.push(["", "", ""]);

    autoTable(pdf, {
      ...TABLE_BASE_STYLES,
      startY: y,
      head: [["INGREDIENT", "% BY WEIGHT", "COUNTRY OF ORIGIN"]],
      body: ingBody,
      columnStyles: { 0: { cellWidth: CONTENT_W * 0.5 }, 1: { halign: "center", cellWidth: CONTENT_W * 0.2 }, 2: { halign: "center" } },
    });
    y = pdf.lastAutoTable.finalY + 8;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text('* Must total 100%. Use "<0.5%" where applicable.', PAGE.margin, y);

    if (po.po_prefix === "55") {
      pdf.addPage();
      y = fdcFormTitle(pdf, PAGE.margin + 8, "Form 3 – EU Compliance");
      autoTable(pdf, {
        ...TABLE_BASE_STYLES,
        startY: y,
        head: [["INGREDIENT", "%", "COO", "TYPE", "APPROVAL #", "DAIRY HT", "EGG HT"]],
        body: ingList.map((ing) => [
          ing.name || "", ing.pct_by_weight || "", ing.country_of_origin || "",
          ing.animal_or_plant || "", ing.approval_number || "", ing.heat_treatment || "", ing.heat_treatment_eggs || "",
        ]),
      });
      y = pdf.lastAutoTable.finalY + 30;
      pdf.setDrawColor(0, 0, 0);
      pdf.line(PAGE.margin, y, PAGE.margin + 220, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text("Vendor Signature", PAGE.margin, y + 12);
    }
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}

// ---- Repeat Vendor Approval --------------------------------------------------

export async function buildRepeatFdcPdf({ po, vendor }) {
  const pdf = newPdf();
  const items = po.items || [];
  let y = PAGE.margin;

  try {
    const dataUrl = await loadBrandImage(HEADER_IMG, HEADER_FALLBACK);
    const props = pdf.getImageProperties(dataUrl);
    const imgH = (props.height / props.width) * CONTENT_W;
    pdf.addImage(dataUrl, PAGE.margin, y, CONTENT_W, imgH);
    y += imgH + 16;
  } catch {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(200, 0, 0);
    pdf.text("TJX EUROPE", PAGE.margin, y + 14);
    pdf.setTextColor(0, 0, 0);
    y += 30;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("REPEAT ORDERS PROCESS", PAGE.w / 2, y, { align: "center" });
  const titleWidth = pdf.getTextWidth("REPEAT ORDERS PROCESS");
  pdf.setLineWidth(0.75);
  pdf.line(PAGE.w / 2 - titleWidth / 2, y + 2, PAGE.w / 2 + titleWidth / 2, y + 2);
  y += 24;

  pdf.setFontSize(10);
  pdf.text("From: TJX Europe, 73 Clarendon Road, Watford, Herts, WD17 1TX", PAGE.margin, y);
  y += 16;
  pdf.text(`For: ${vendor.company_name || ""}`, PAGE.margin, y);
  y += 8;
  pdf.line(PAGE.margin, y, PAGE.w - PAGE.margin, y);
  y += 18;

  pdf.setFont("helvetica", "bold");
  pdf.text("Dear Vendor,", PAGE.margin, y);
  y += 16;

  pdf.setFont("helvetica", "normal");
  const bodyText =
    `As it has been agreed, this document serves as an exception for all vendors shipping REPEAT ORDERS ` +
    `and can be uploaded on the portal to replace the 'FDC' FOOD DETAIL CHECKLIST, upon receipt of the ` +
    `Collection Date from the carrier. This exception is valid for ${po.po_prefix || ""} Prefix: ${vendor.company_name || ""}.`;
  const bodyLines = pdf.splitTextToSize(bodyText, CONTENT_W);
  pdf.text(bodyLines, PAGE.margin, y);
  y += bodyLines.length * 13 + 8;

  const noteLines = pdf.splitTextToSize('Please upload this document when booking your POs as your "Food Detail Checklist".', CONTENT_W);
  pdf.text(noteLines, PAGE.margin, y);
  y += noteLines.length * 13 + 16;

  const tableW = CONTENT_W * 0.6;
  const tableX = PAGE.margin + (CONTENT_W - tableW) / 2;

  autoTable(pdf, {
    ...TABLE_BASE_STYLES,
    startY: y,
    margin: { left: tableX, right: PAGE.margin },
    tableWidth: tableW,
    head: [["VENDOR STYLE CHECKED", "VENDOR STYLE TO BE SHIPPED"]],
    body: items.length > 0
      ? items.map((item) => [item.item_number || item.vendor_style || "", "YES"])
      : [[{ content: "No items on this PO", colSpan: 2, styles: { halign: "center", textColor: [150, 150, 150] } }]],
    columnStyles: { 0: { halign: "center" }, 1: { halign: "center" } },
    styles: { ...TABLE_BASE_STYLES.styles, fontSize: 9 },
  });

  y = pdf.lastAutoTable.finalY + 20;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text("Kind regards,", PAGE.margin, y);
  y += 14;
  pdf.text("TJX Europe Logistics Team", PAGE.margin, y);
  y += 20;

  try {
    const dataUrl = await loadBrandImage(FOOTER_IMG, FOOTER_FALLBACK);
    const props = pdf.getImageProperties(dataUrl);
    const imgH = (props.height / props.width) * CONTENT_W;
    if (y + imgH > PAGE.h - PAGE.margin) pdf.addPage();
    pdf.addImage(dataUrl, PAGE.margin, y, CONTENT_W, imgH);
  } catch {
    // Footer image unavailable — safe to omit.
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}

// ---- shared byte/base64 helpers --------------------------------------------

export function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ---- error classification + status -----------------------------------------

// Re-exported from the single classifier so existing importers keep working.
export { isOutOfCredits, friendlyErrorMessage } from '@/lib/errors';
// Re-exported so existing importers of emailDocs keep working; the
// definition lives in @/domain/poStatus.
export { STATUS_ORDER, bumpStatus } from '@/domain/poStatus';


// ---- compression + batching -------------------------------------------------

export async function compressPdf(bytes) {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const compressed = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return compressed.length < bytes.length ? compressed : bytes;
  } catch {
    return bytes;
  }
}

/**
 * Bin-packs already-generated PDF bytes into batches under SAFE_BATCH_BYTES.
 * A single PO can contribute several files (invoice + packing list + FDC),
 * so batches aren't grouped by PO. subject/body stay identical across
 * batches aside from a "(i/n)" suffix and attachment-count note.
 */
export async function buildEmailBatches({ files, to, from, subject, body }) {
  const compressedFiles = [];
  for (const f of files) {
    const before = f.bytes.length;
    const bytes = await compressPdf(f.bytes);
    console.log(`${f.filename}: ${(before / 1024 / 1024).toFixed(1)}MB → ${(bytes.length / 1024 / 1024).toFixed(1)}MB`);
    compressedFiles.push({ filename: f.filename, bytes });
  }

  const rawBatches = [];
  let current = [], currentSize = 0;
  for (const f of compressedFiles) {
    if (currentSize + f.bytes.length > SAFE_BATCH_BYTES && current.length > 0) {
      rawBatches.push(current);
      current = [f];
      currentSize = f.bytes.length;
    } else {
      current.push(f);
      currentSize += f.bytes.length;
    }
  }
  if (current.length > 0) rawBatches.push(current);

  return Promise.all(
    rawBatches.map(async (batchFiles, i) => {
      const suffix = rawBatches.length > 1 ? ` (${i + 1}/${rawBatches.length})` : "";
      const batchSubject = subject + suffix;
      const batchBody = body + (rawBatches.length > 1 ? `\n\n[Email ${i + 1} of ${rawBatches.length} — ${batchFiles.length} attachment(s)]` : "");

      const zip = new JSZip();
      let totalBytes = 0;
      for (const f of batchFiles) {
        zip.file(f.filename, f.bytes);
        totalBytes += f.bytes.length;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });

      return {
        id: `batch-${i}`,
        to,
        from,
        subject: batchSubject,
        body: batchBody,
        fileNames: batchFiles.map((f) => f.filename),
        files: batchFiles,
        totalBytes,
        zipBlob,
        zipName: rawBatches.length > 1 ? `shipping_docs_${i + 1}_of_${rawBatches.length}.zip` : "shipping_docs.zip",
      };
    })
  );
}

export function downloadBatchZipAndOpenMailDraft(batch) {
  const zipUrl = URL.createObjectURL(batch.zipBlob);
  const a = document.createElement("a");
  a.href = zipUrl;
  a.download = batch.zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);

  const mailtoUrl = `mailto:${encodeURIComponent(batch.to)}?subject=${encodeURIComponent(
    batch.subject
  )}&body=${encodeURIComponent(batch.body + `\n\n(Documents attached as ${batch.zipName} — please attach the file just downloaded.)`)}`;
  window.location.href = mailtoUrl;
}

// ---- .eml builder (real attachments, opens as a ready-to-send draft) ------

function wrapBase64(base64) {
  // String.match returns null (not []) when there is no match, so an empty
  // attachment threw "Cannot read properties of null" mid-send rather than
  // producing an empty part.
  return (String(base64 || "").match(/.{1,76}/g) || []).join("\r\n");
}

export function buildEmlBlob({ from, to, subject, body, files }) {
  const boundary = `----shipping-docs-${Date.now().toString(36)}`;
  const { encoding: bodyEncoding, body: crlfBody } = encodeTextBody(body);

  let eml = "";
  eml += `From: ${encodeAddressHeader(from)}\r\n`;
  eml += `To: ${encodeAddressHeader(to)}\r\n`;
  eml += `Subject: ${encodeHeader(subject)}\r\n`;
  eml += `X-Unsent: 1\r\n`;
  eml += `MIME-Version: 1.0\r\n`;
  eml += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
  eml += `\r\n`;
  eml += `--${boundary}\r\n`;
  eml += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  eml += `Content-Transfer-Encoding: ${bodyEncoding}\r\n`;
  eml += `\r\n`;
  eml += `${crlfBody}\r\n`;
  eml += `\r\n`;

  for (const f of files) {
    const base64 = wrapBase64(uint8ToBase64(f.bytes));
    eml += `--${boundary}\r\n`;
    eml += `Content-Type: application/pdf; name="${f.filename}"\r\n`;
    eml += `Content-Transfer-Encoding: base64\r\n`;
    eml += `Content-Disposition: attachment; filename="${f.filename}"\r\n`;
    eml += `\r\n`;
    eml += `${base64}\r\n`;
    eml += `\r\n`;
  }

  eml += `--${boundary}--\r\n`;

  return new Blob([eml], { type: "message/rfc822" });
}

export function downloadBatchEml(batch) {
  const emlBlob = buildEmlBlob({ from: batch.from, to: batch.to, subject: batch.subject, body: batch.body, files: batch.files });
  const emlName = batch.zipName.replace(/\.zip$/, ".eml");
  const emlUrl = URL.createObjectURL(emlBlob);
  const a = document.createElement("a");
  a.href = emlUrl;
  a.download = emlName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(emlUrl), 10000);
}