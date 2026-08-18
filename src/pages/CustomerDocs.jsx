import { useState, useRef, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM, uploadFile } from "@/lib/aiClient";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, Sparkles, Loader2, Printer, FileText, Package, X, RefreshCw, Save, FolderOpen, ChevronRight, Trash2, Download, Tag, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import CustomerInvoiceDoc from "@/components/documents/CustomerInvoiceDoc";
import CustomerPackingListDoc from "@/components/documents/CustomerPackingListDoc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/dates";

/**
 * HTML escape for the pallet-label window.
 *
 * This was called seven times and never defined anywhere in the codebase, so
 * every click on "Pallet Labels" threw ReferenceError before rendering — the
 * feature has never worked. It is also genuinely needed: supplier, customer and
 * PO text here is LLM-extracted from a customer document and written straight
 * into document.write.
 */
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');


const EMPTY_DATA = {
  customer: "",
  supplier: "",
  po: "",
  invoiceNumber: "",
  invoiceDate: "",
  currency: "USD",
  commonName: "",
  items: [],
};

// Same 402/403 classification used in TjxCanada.jsx / Invoices.jsx / CommercialInvoice.jsx —
// gives a clear message instead of a silent failure when integration credits
// run out or a backend function isn't available on the current plan.

export default function CustomerDocs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [activeDoc, setActiveDoc] = useState("invoice"); // "invoice" | "packing"
  const [data, setData] = useState(EMPTY_DATA);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFile, setAiFile] = useState(null);
  const [aiFileUrl, setAiFileUrl] = useState(null);
  const [aiFileName, setAiFileName] = useState(null);
  const [aiError, setAiError] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [saving, setSaving] = useState(false);
  // Which saved record the form is editing, if any.
  const [currentInvoiceId, setCurrentInvoiceId] = useState(null);
  const [catalogNotice, setCatalogNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [openMonths, setOpenMonths] = useState({});
  const [palletCount, setPalletCount] = useState(1);

  const { data: savedInvoices = [] } = useQuery({
    queryKey: ["customerInvoices"],
    queryFn: () => base44.entities.CustomerInvoice.list("-created_date", 200),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => base44.entities.Product.list(),
  });

  const productByUpc = {};
  products.forEach(p => { if (p.upc_code) productByUpc[p.upc_code.trim()] = p; });

  const enrichItemsWithCatalog = useCallback((items) => {
    return (items || []).map(item => {
      const upc = (item.upc || "").trim();
      const match = productByUpc[upc];
      if (match) {
        return {
          ...item,
          gross_weight_kg: item.gross_weight_kg || match.carton_gross_weight_kg || 0,
          net_weight_kg: item.net_weight_kg || match.carton_net_weight_kg || 0,
          country_of_origin: item.country_of_origin || match.country_of_origin || "",
          hs_code: item.hs_code || match.hs_code || "",
        };
      }
      return item;
    });
  }, [products]);

  const saveNewProductsToCatalog = useCallback(async (items) => {
    const toCreate = (items || []).filter(item => {
      const upc = (item.upc || "").trim();
      return upc && !productByUpc[upc];
    });
    if (toCreate.length === 0) return { created: 0, failed: [] };

    // One insert per new product, in a single batched call rather than a
    // sequential round trip each. Previously a failure on any one item — a
    // duplicate item_number now that the column is unique, say — threw out of
    // this loop, so the products after it were never created AND the caller
    // reported "Failed to extract data from this document", even though
    // extraction had succeeded and the form was already populated.
    const rows = toCreate.map(item => ({
      item_number: item.upc || "",
      upc_code: item.upc || "",
      description: item.description || "",
      country_of_origin: item.country_of_origin || "",
      carton_gross_weight_kg: item.gross_weight_kg ?? null,
      carton_net_weight_kg: item.net_weight_kg ?? null,
      hs_code: item.hs_code ?? null,
    }));

    try {
      await base44.entities.Product.bulkCreate(rows);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      return { created: rows.length, failed: [] };
    } catch (bulkError) {
      // Fall back to one-at-a-time so a single bad row cannot cost the rest.
      const failed = [];
      let created = 0;
      for (const row of rows) {
        try {
          await base44.entities.Product.create(row);
          created += 1;
        } catch (err) {
          console.error("Could not add product to catalog:", row.item_number, err);
          failed.push(row.item_number || row.description);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["products"] });
      return { created, failed, bulkError };
    }
  }, [products, queryClient]);

  const grouped = {};
  savedInvoices.forEach(inv => {
    const key = formatDate(inv.created_date, "MMMM yyyy", "Unknown");
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(inv);
  });
  const monthKeys = Object.keys(grouped);

  const toggleMonth = (k) => setOpenMonths(prev => ({ ...prev, [k]: !prev[k] }));

  const saveInvoice = async () => {
    setSaving(true);
    setSaveError("");
    try {
      // Loading a saved invoice and pressing Save used to create a SECOND
      // record every time, leaving the uncorrected original in the archive
      // alongside it.
      if (currentInvoiceId) {
        await base44.entities.CustomerInvoice.update(currentInvoiceId, data);
      } else {
        const created = await base44.entities.CustomerInvoice.create(data);
        if (created?.id) setCurrentInvoiceId(created.id);
      }
      queryClient.invalidateQueries({ queryKey: ["customerInvoices"] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setSaveError(friendlyErrorMessage(err, "Failed to save invoice."));
    } finally {
      setSaving(false);
    }
  };

  const deleteInvoice = async (id) => {
    const inv = savedInvoices.find(i => i.id === id);
    const label = inv?.invoiceNumber || inv?.po || "this invoice";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      await base44.entities.CustomerInvoice.delete(id);
      if (currentInvoiceId === id) setCurrentInvoiceId(null);
      queryClient.invalidateQueries({ queryKey: ["customerInvoices"] });
    } catch (err) {
      setSaveError(friendlyErrorMessage(err, "Failed to delete invoice."));
    }
  };

  const loadInvoice = (inv) => {
    const { id, created_date, updated_date, created_by, ...rest } = inv;
    setCurrentInvoiceId(id);
    setData({
      customer: rest.customer || "",
      supplier: rest.supplier || "",
      po: rest.po || "",
      invoiceNumber: rest.invoiceNumber || "",
      invoiceDate: rest.invoiceDate || "",
      currency: rest.currency || "USD",
      commonName: rest.commonName || "",
      items: rest.items || [],
    });
  };

  const handleParseStatus = (s) => {
    if (s.phase === "done") {
      setParseStatus("Used: Gemini API");
    } else if (s.message) {
      setParseStatus(s.message);
    }
  };

  const handleAiImport = async () => {
    if (!aiFile) return;
    setAiLoading(true);
    setAiError("");
    setParseStatus("");
    try {
      const uploadFileName = aiFile.name;
      const isPdf = aiFile.type === "application/pdf";
      const { file_url } = await uploadFile({ file: aiFile });
      if (isPdf) {
        setAiFileUrl(file_url);
        setAiFileName(uploadFileName);
      }
      const result = await invokeLLM({
        prompt: `Extract all information from this Purchase Order document.

Return:
- customer: full buyer/customer name and address (multi-line string)
- supplier: full supplier/vendor name and address (multi-line string, look for "SUPPLIER" or "Ship From" or "Vendor")
- po: the purchase order number (just the number)
- invoiceNumber: invoice number if present, otherwise empty string
- invoiceDate: date of the PO/invoice in MM/DD/YYYY format
- currency: currency code (USD, CAD, etc.)
- commonName: a short generic product category name describing what the shipment contains, ignoring brand names, flavors, and variants. Examples: "Coffee Syrup", "Protein Powder", "Energy Drink", "Hot Sauce". 2-3 words max.
- items: array of all line items, each with:
    - upc: UPC barcode number
    - description: full product description
    - pack: pack size (e.g. "6 x 750 ml", "12 x 375 ml")
    - qty: quantity ordered (number)
    - unit_price: unit price as a number
    - total_amount: total line amount as a number
    - gross_weight_kg: gross weight per carton in kg (if listed)
    - net_weight_kg: net weight per carton in kg (if listed)
    - country_of_origin: country of origin if listed (e.g. "USA", "Canada")
    - hs_code: Harmonized System (HS) tariff code if listed in the document. If not listed, infer the most likely 6-digit HS code based on the product description and category (e.g. flavored syrups → 2106.90, protein powder → 2106.10, energy drinks → 2202.99). Return only digits and dots, no spaces.

Extract EVERY line item. Do not skip any rows.`,
        file_urls: [file_url],
        filename: aiFile.name,
        onStatus: handleParseStatus,
        response_json_schema: {
          type: "object",
          properties: {
            customer: { type: "string" },
            supplier: { type: "string" },
            po: { type: "string" },
            invoiceNumber: { type: "string" },
            invoiceDate: { type: "string" },
            currency: { type: "string" },
            commonName: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  upc: { type: "string" },
                  description: { type: "string" },
                  pack: { type: "string" },
                  qty: { type: "number" },
                  unit_price: { type: "number" },
                  total_amount: { type: "number" },
                  gross_weight_kg: { type: "number" },
                  net_weight_kg: { type: "number" },
                  country_of_origin: { type: "string" },
                  hs_code: { type: "string" },
                }
              }
            }
          }
        }
      });
      // A fresh extraction is a new document, not an edit of whatever was
      // previously loaded from the archive.
      setCurrentInvoiceId(null);
      setData({
        customer: result.customer || "",
        supplier: result.supplier || "",
        po: result.po || "",
        invoiceNumber: result.invoiceNumber || "",
        invoiceDate: result.invoiceDate || "",
        currency: result.currency || "USD",
        commonName: result.commonName || "",
        items: enrichItemsWithCatalog(result.items || []),
      });
      setAiFile(null);

      // Adding new products to the catalog is a side benefit of extraction, not
      // part of it. It must never be able to report the extraction as failed —
      // which is exactly what used to happen, sending the user off to re-upload
      // (and re-pay for) a document that had parsed perfectly.
      const catalogResult = await saveNewProductsToCatalog(
        enrichItemsWithCatalog(result.items || [])
      );
      if (catalogResult?.failed?.length) {
        setCatalogNotice(
          `Extracted successfully. ${catalogResult.created} new product${catalogResult.created === 1 ? "" : "s"} added to the catalog; ` +
          `${catalogResult.failed.length} could not be added (${catalogResult.failed.slice(0, 3).join(", ")}).`
        );
      } else if (catalogResult?.created) {
        setCatalogNotice(
          `${catalogResult.created} new product${catalogResult.created === 1 ? "" : "s"} added to the catalog.`
        );
      }
    } catch (err) {
      setAiError(friendlyErrorMessage(err, "Failed to extract data from this document. Please try again."));
    } finally {
      setAiLoading(false);
    }
  };

  const updateItem = (idx, key, val) => {
    setData(d => {
      const items = [...d.items];
      let updated = { ...items[idx], [key]: val };
      if (key === "upc") {
        const match = productByUpc[val.trim()];
        if (match) {
          updated.gross_weight_kg = match.carton_gross_weight_kg || updated.gross_weight_kg || 0;
          updated.net_weight_kg = match.carton_net_weight_kg || updated.net_weight_kg || 0;
          updated.country_of_origin = match.country_of_origin || updated.country_of_origin || "";
          updated.hs_code = match.hs_code || updated.hs_code || "";
        }
      }
      items[idx] = updated;
      return { ...d, items };
    });
  };

  const removeItem = (idx) => {
    setData(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  };

  const addItem = () => {
    setData(d => ({ ...d, items: [...d.items, { upc: "", description: "", pack: "", qty: 0, unit_price: 0, total_amount: 0, gross_weight_kg: 0, net_weight_kg: 0, country_of_origin: "" }] }));
  };

  const handlePrintPalletLabels = () => {
    const count = parseInt(palletCount) || 1;
    const supplier = data.supplier || "";
    const customer = data.customer || "";
    const po = data.po || "";
    const itemsList = data.items || [];

    const totalCartons = itemsList.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);

    const totalWeight = itemsList.reduce((s, i) => {
      const gross = parseFloat(i.gross_weight_kg) || 0;
      const qty = parseFloat(i.qty) || 0;
      return s + (gross * qty);
    }, 0);

    const weightPerPallet = totalWeight > 0 ? totalWeight / count : 0;

    const containsSummary = (data.commonName || "").trim();

    const supplierLines = supplier.split("\n");
    const customerLines = customer.split("\n");

    const labelsHtml = Array.from({ length: count }, (_, idx) => `
      <div class="label">
        <div class="pallet-num">PALLET ${idx + 1} of ${count}</div>
        <div class="two-col">
          <div class="box">
            <div class="box-label">FROM:</div>
            <div class="bold">${esc(supplierLines[0] || "")}</div>
            ${supplierLines.slice(1).map(l => `<div>${esc(l)}</div>`).join("")}
          </div>
          <div class="box">
            <div class="box-label">SHIP TO:</div>
            <div class="bold">${esc(customerLines[0] || "")}</div>
            ${customerLines.slice(1).map(l => `<div>${esc(l)}</div>`).join("")}
          </div>
        </div>
        <div class="box">
          <div class="box-label">PO NUMBER</div>
          <div style="font-size:20px;font-weight:bold;">${esc(po)}</div>
        </div>
        ${containsSummary ? `<div class="box"><div class="box-label">CONTAINS</div><div style="font-size:13px;font-weight:bold;">${esc(containsSummary)}</div></div>` : ""}
        <div class="box"><div class="box-label">TOTAL CARTONS</div>${totalCartons || "—"}</div>
        <div class="box"><div class="box-label">TOTAL PALLETS</div>${count}</div>
        <div class="box"><div class="box-label">GROSS WEIGHT (this pallet)</div>${weightPerPallet ? weightPerPallet.toFixed(1) + " kg" : "—"}</div>
        <div class="box"><div class="box-label">TOTAL GROSS WEIGHT (all pallets)</div>${totalWeight ? totalWeight.toFixed(1) + " kg" : "—"}</div>
        <div class="footer">Handle with care | Keep dry | This side up</div>
      </div>`).join("");

    const win = window.open("", "_blank", "width=960,height=720");
    if (!win) { alert("Please allow popups to print pallet labels."); return; }
    win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Pallet Labels – PO ${esc(po)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; font-family:Arial,sans-serif; font-size:12px; color:#000; }
  .label { width:4in;height:6in;padding:.2in;page-break-after:always;break-after:page;display:flex;flex-direction:column;gap:5px; }
  .pallet-num { text-align:center;font-weight:bold;font-size:24px;border:2px solid #000;padding:6px; }
  .two-col { display:grid;grid-template-columns:1fr 1fr;gap:4px; }
  .box { border:2px solid #000;padding:5px 7px; }
  .box-label { font-weight:bold;font-size:10px;margin-bottom:2px; }
  .bold { font-weight:bold; }
  .footer { margin-top:auto;font-size:10px;font-weight:bold;border-top:2px solid #000;padding-top:5px; }
  @media screen {
    body { background:#ccc;display:flex;flex-direction:column;align-items:center;padding:60px 20px 20px;gap:20px; }
    .label { background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2); }
    .print-bar { position:fixed;top:0;left:0;right:0;background:#1e293b;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;font-family:Arial;font-size:14px;z-index:9999; }
    .print-btn { background:#f59e0b;color:#000;border:none;border-radius:6px;padding:8px 18px;font-weight:bold;font-size:14px;cursor:pointer; }
    .print-btn:hover { background:#d97706; }
  }
  @media print { .print-bar { display:none; } }
</style></head>
<body>
  <div class="print-bar">
    <span>🏷 ${count} Pallet Label${count !== 1 ? "s" : ""} — PO ${po}</span>
    <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
  </div>
  ${labelsHtml}
</body></html>`);
    win.document.close();
  };

  const handleDownloadPdf = async (docType) => {
    const { default: html2canvas } = await import("html2canvas");
    const { jsPDF } = await import("jspdf");
    const el = document.getElementById("doc-preview-area");
    if (!el) return;

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentW = pageW - margin * 2;

    const canvas = await html2canvas(el, { scale: 1.2, useCORS: true, logging: false, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.75);
    const imgH = (canvas.height * contentW) / canvas.width;
    const pageContentH = pageH - margin * 2;

    // FIX: the previous version redrew the same full image at the same
    // (margin, margin) position on every page, so any invoice/packing list
    // spanning more than one page just repeated page 1's content instead of
    // continuing. Same fix as CommercialInvoice.jsx: draw the SAME
    // full-height image every time, but shift its y-position up by one
    // page's height on each iteration so a different vertical band lands
    // in the visible page area.
    let heightLeft = imgH;
    let position = margin;
    let firstPage = true;

    while (heightLeft > 0) {
      if (!firstPage) pdf.addPage();
      pdf.addImage(imgData, "JPEG", margin, position, contentW, imgH, undefined, "FAST");
      heightLeft -= pageContentH;
      position -= pageContentH;
      firstPage = false;
    }

    pdf.save(`${docType === "invoice" ? "Invoice" : "PackingList"}_${data.po || data.invoiceNumber || "document"}.pdf`);
  };

  const hasData = data.items.length > 0 || data.customer || data.supplier;

  // Live kg/pallet preview
  const totalWeightLive = (data.items || []).reduce((s, i) => {
    return s + (parseFloat(i.gross_weight_kg) || 0) * (parseFloat(i.qty) || 0);
  }, 0);
  const weightPerPalletLive = totalWeightLive > 0 && parseInt(palletCount) > 0
    ? (totalWeightLive / parseInt(palletCount)).toFixed(1)
    : null;

  // Ctrl+Shift+L → print pallet labels
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "L" && hasData) {
        e.preventDefault();
        handlePrintPalletLabels();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasData, palletCount, data]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Customer Documents</h1>
        {hasData && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveInvoice} disabled={saving} className="border-green-300 text-green-700 hover:bg-green-50">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : savedFlash ? <FileText className="w-4 h-4 mr-1 text-green-600" /> : <Save className="w-4 h-4 mr-1" />}
              {saving ? "Saving…" : savedFlash ? "Saved!" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(activeDoc)} className="border-gray-300 text-gray-700 hover:bg-gray-50">
              <Download className="w-4 h-4 mr-1" />
              Download PDF
            </Button>
            <Button size="sm" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
              <Printer className="w-4 h-4 mr-1" />
              Print {activeDoc === "invoice" ? "Invoice" : "Packing List"}
            </Button>
            <div className="flex items-center gap-1 border border-amber-300 rounded-md px-2 py-1">
              <Tag className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <input
                type="number" min={1} max={99}
                value={palletCount}
                onChange={e => setPalletCount(e.target.value)}
                className="w-10 text-xs text-center border-0 outline-none bg-transparent text-amber-800 font-semibold"
              />
              <button
                onClick={handlePrintPalletLabels}
                title="Print pallet labels (Ctrl+Shift+L)"
                className="text-xs text-amber-700 font-semibold hover:text-amber-900"
              >
                Pallet Labels
              </button>
              {weightPerPalletLive && (
                <span className="text-xs text-amber-500 font-normal ml-1">≈ {weightPerPalletLive} kg/pallet</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save error banner */}
      {saveError && (
        <div className="mx-6 mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm no-print">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{saveError}</span>
          <button onClick={() => setSaveError("")} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Doc type tabs + AI import */}
      <div className="bg-white border-b px-6 py-3 no-print space-y-3">
        {/* Tab switcher */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveDoc("invoice")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeDoc === "invoice" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
          >
            <FileText className="w-4 h-4" /> Commercial Invoice
          </button>
          <button
            onClick={() => setActiveDoc("packing")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeDoc === "packing" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
          >
            <Package className="w-4 h-4" /> Packing List
          </button>
        </div>

        {/* AI import row */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 border-2 border-dashed rounded-lg px-4 py-2 cursor-pointer transition-colors flex-1 ${aiFile ? "border-purple-400 bg-purple-50" : "border-gray-300 hover:border-purple-400 hover:bg-purple-50"}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setAiFile(f); setAiFileName(f.name); setAiError(""); } }}
          >
            <Upload className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="text-sm text-gray-600 truncate">{aiFile ? aiFile.name : aiFileName ? `✓ ${aiFileName}` : "Drop or click to upload PO (PDF, image, Excel)..."}</span>
            {(aiFile || aiFileName) && <button onClick={e => { e.stopPropagation(); setAiFile(null); setAiFileUrl(null); setAiFileName(null); setAiError(""); }} className="ml-auto"><X className="w-4 h-4 text-gray-400 hover:text-gray-600" /></button>}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" className="hidden" onChange={e => { const f = e.target.files[0]; if (f) { setAiFile(f); setAiFileName(f.name); setAiError(""); } }} />
          <Button onClick={handleAiImport} disabled={!aiFile || aiLoading} className="bg-purple-600 hover:bg-purple-700 flex-shrink-0">
            {aiLoading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Extracting...</> : <><Sparkles className="w-4 h-4 mr-1" />Extract with AI</>}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setCurrentInvoiceId(null); setData(EMPTY_DATA); setAiFile(null); setAiFileUrl(null); setAiFileName(null); setAiError(""); setParseStatus(""); }} className="flex-shrink-0 text-gray-500">
            <RefreshCw className="w-4 h-4 mr-1" /> Reset
          </Button>
        </div>

        {parseStatus && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2 text-blue-700 text-xs">
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            {parseStatus}
          </div>
        )}

        {/* AI import error */}
        {aiError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {aiError}
          </div>
        )}

        {/* Catalog side effects — informational, never blocking */}
        {catalogNotice && (
          <div className="flex items-start justify-between gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 text-sm">
            <span>{catalogNotice}</span>
            <button
              onClick={() => setCatalogNotice("")}
              className="text-blue-500 hover:text-blue-700 text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Editable header fields */}
        {hasData && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t">
            <div>
              <Label className="text-xs text-gray-500">PO Number</Label>
              <Input value={data.po} onChange={e => setData(d => ({ ...d, po: e.target.value }))} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Invoice Number</Label>
              <Input value={data.invoiceNumber} onChange={e => setData(d => ({ ...d, invoiceNumber: e.target.value }))} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Invoice Date</Label>
              <Input value={data.invoiceDate} onChange={e => setData(d => ({ ...d, invoiceDate: e.target.value }))} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Currency</Label>
              <Input value={data.currency} onChange={e => setData(d => ({ ...d, currency: e.target.value }))} className="h-8 text-sm mt-1 w-24" />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Common Name <span className="text-purple-400 font-normal">(for pallet label)</span></Label>
              <Input value={data.commonName || ""} onChange={e => setData(d => ({ ...d, commonName: e.target.value }))} placeholder="e.g. Coffee Syrup" className="h-8 text-sm mt-1" />
            </div>
            <div className="col-span-2 md:col-span-1">
              <Label className="text-xs text-gray-500">Supplier</Label>
              <Textarea value={data.supplier} onChange={e => setData(d => ({ ...d, supplier: e.target.value }))} rows={2} className="text-xs mt-1" />
            </div>
            <div className="col-span-2 md:col-span-1">
              <Label className="text-xs text-gray-500">Customer / Buyer</Label>
              <Textarea value={data.customer} onChange={e => setData(d => ({ ...d, customer: e.target.value }))} rows={2} className="text-xs mt-1" />
            </div>
          </div>
        )}

        {/* Items editor */}
        {hasData && (
          <div className="border-t pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600">{data.items.length} line items</span>
              <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs">+ Add Row</Button>
            </div>
            <div className="max-h-48 overflow-y-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {["UPC", "Description", "Pack", "Qty", "Unit Price", "Total", "Gross kg", "Net kg", "COO", "HS Code", ""].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-1 py-1"><Input value={item.upc || ""} onChange={e => updateItem(idx, "upc", e.target.value)} className="h-6 text-xs px-1 w-28" /></td>
                      <td className="px-1 py-1"><Input value={item.description || ""} onChange={e => updateItem(idx, "description", e.target.value)} className="h-6 text-xs px-1 w-48" /></td>
                      <td className="px-1 py-1"><Input value={item.pack || ""} onChange={e => updateItem(idx, "pack", e.target.value)} className="h-6 text-xs px-1 w-24" /></td>
                      <td className="px-1 py-1"><Input type="number" value={item.qty || ""} onChange={e => updateItem(idx, "qty", parseFloat(e.target.value) || 0)} className="h-6 text-xs px-1 w-16" /></td>
                      <td className="px-1 py-1"><Input type="number" value={item.unit_price || ""} onChange={e => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)} className="h-6 text-xs px-1 w-20" /></td>
                      <td className="px-1 py-1"><Input type="number" value={item.total_amount || ""} onChange={e => updateItem(idx, "total_amount", parseFloat(e.target.value) || 0)} className="h-6 text-xs px-1 w-20" /></td>
                      <td className="px-1 py-1"><Input type="number" value={item.gross_weight_kg || ""} onChange={e => updateItem(idx, "gross_weight_kg", parseFloat(e.target.value) || 0)} className="h-6 text-xs px-1 w-16" /></td>
                      <td className="px-1 py-1"><Input type="number" value={item.net_weight_kg || ""} onChange={e => updateItem(idx, "net_weight_kg", parseFloat(e.target.value) || 0)} className="h-6 text-xs px-1 w-16" /></td>
                      <td className="px-1 py-1"><Input value={item.country_of_origin || ""} onChange={e => updateItem(idx, "country_of_origin", e.target.value)} className="h-6 text-xs px-1 w-14" /></td>
                      <td className="px-1 py-1"><Input value={item.hs_code || ""} onChange={e => updateItem(idx, "hs_code", e.target.value)} className="h-6 text-xs px-1 w-24" /></td>
                      <td className="px-1 py-1"><button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Main area with optional sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Saved invoices sidebar */}
        {savedInvoices.length > 0 && (
          <div className="no-print w-64 bg-white border-r flex-shrink-0 overflow-y-auto">
            <div className="px-4 py-3 border-b">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Saved Invoices</span>
            </div>
            <div className="divide-y">
              {monthKeys.map(month => (
                <div key={month}>
                  <button
                    onClick={() => toggleMonth(month)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 text-left"
                  >
                    <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="text-xs font-semibold text-gray-700 flex-1">{month}</span>
                    <span className="text-xs text-gray-400 mr-1">{grouped[month].length}</span>
                    <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform ${openMonths[month] ? "rotate-90" : ""}`} />
                  </button>
                  {openMonths[month] && (
                    <div className="bg-gray-50 divide-y">
                      {grouped[month].map(inv => (
                        <div key={inv.id} className="flex items-center gap-1 px-4 py-2 group">
                          <button
                            onClick={() => loadInvoice(inv)}
                            className="flex-1 text-left"
                          >
                            <p className="text-xs font-medium text-gray-800 truncate">
                              {inv.po ? `PO# ${inv.po}` : inv.customer?.split("\n")[0] || "Untitled"}
                            </p>
                            <p className="text-xs text-gray-400 truncate">{inv.customer?.split("\n")[0]}</p>
                          </button>
                          <button
                            onClick={() => deleteInvoice(inv.id)}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document preview */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Source PDF preview */}
            {aiFileUrl && (
              <div className="bg-white border border-blue-200 rounded-lg p-4 flex items-center gap-4 shadow-sm">
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{aiFileName || "Source PDF"}</p>
                  {data.supplier && <p className="text-xs text-gray-500">From: <span className="font-medium text-gray-700">{data.supplier.split("\n")[0]}</span></p>}
                </div>
                <a href={aiFileUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50 flex-shrink-0">
                    <Download className="w-3.5 h-3.5 mr-1" /> Open PDF ↗
                  </Button>
                </a>
                <button onClick={() => { setAiFile(null); setAiFileUrl(null); setAiFileName(null); }} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-4 h-4" /></button>
              </div>
            )}

            <div id="doc-preview-area">
              {activeDoc === "invoice" && <CustomerInvoiceDoc data={data} />}
              {activeDoc === "packing" && (
                <CustomerPackingListDoc
                  data={{
                    ...data,
                    showExtendedLogistics: true,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}