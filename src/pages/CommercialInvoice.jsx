import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM, uploadFile } from "@/lib/aiClient";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  Upload,
  Sparkles,
  Loader2,
  Printer,
  Download,
  AlertCircle,
  CheckCircle,
  X,
  RefreshCw,
  Save,
  Search,
  Trash2,
  FileText,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import BrendamourInvoiceDoc from "@/components/documents/BrendamourInvoiceDoc";
import InboundVerificationDoc from "@/components/documents/InboundVerificationDoc";
import { parseWarehouseReport } from "@/utils/warehouseReportParser";
import { friendlyErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/dates";
import { addPaginatedImage } from "@/lib/paginatedImage";

const SELLER = "Dominion Liquid Technologies\n3965 Virginia Ave\nCincinnati, OH 45227\nUSA";
const BUYER = "Capital Nutrition Inc.\n1020 Boul. Michèle-Bohec\nBlainville, QC J7C 5E2\nCanada";

export default function CommercialInvoice() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [view, setView] = useState("new");
  const [inputMode, setInputMode] = useState("paste");
  const [pastedText, setPastedText] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [autoSaveError, setAutoSaveError] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [invoiceData, setInvoiceData] = useState(null);
  const [currentShipmentId, setCurrentShipmentId] = useState(null);
  const [docType, setDocType] = useState("invoice");
  const [savedSearch, setSavedSearch] = useState("");

  const {
    data: products = [],
    isLoading: productsLoading,
    isError: productsFailed,
    error: productsError,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ["products"],
    queryFn: () => base44.entities.Product.list(),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["appsettings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });
  const appSettings = settings?.[0] || {};

  const { data: savedShipments = [] } = useQuery({
    queryKey: ["inboundShipments"],
    queryFn: () => base44.entities.InboundShipment.list("-created_date"),
  });

  const productById = {};
  products.forEach((p) => {
    if (p.id) productById[p.id] = p;
  });

  /* ===== Entity mapping ===== */
  const toEntity = (d) => ({
    transaction_number: d.invoiceNumber || "",
    po_number: d.po || "",
    reference_number: d.referenceNumber || "",
    ship_date: d.ship_date || "",
    seller: d.seller,
    buyer: d.buyer,
    ship_to: d.shipToFromReport || "",
    report_totals: d.reportTotals || {},
    items: (d.items || []).map((i) => ({
      upc: i.upc || "",
      description: i.description || "",
      cases: i.cases || 0,
      unit_price: i.unit_price || 0,
      total_amount: i.total_amount || 0,
      hs_code: i.hs_code || "",
      country_of_origin: i.country_of_origin || "",
      gross_weight_kg: i.gross_weight_kg || 0,
      net_weight_kg: i.net_weight_kg || 0,
      lot_number: i.lot_number || "",
      warehouse_item_number: i.warehouse_item_number || "",
      matched: !!i.matched,
      product_id: i.product_id || null,
    })),
    total_cases: d.totalCartons || 0,
    total_value: d.totalValue || 0,
    total_gross_weight: d.totalGrossWeight || 0,
    total_net_weight: d.totalNetWeight || 0,
    currency: d.currency || "USD",
  });

  const fromEntity = (s) => ({
    invoiceNumber: s.transaction_number || "",
    invoiceDate: s.ship_date
      ? formatDate(s.ship_date, "MM/dd/yyyy", format(new Date(), "MM/dd/yyyy"))
      : format(new Date(), "MM/dd/yyyy"),
    ship_date: s.ship_date || format(new Date(), "yyyy-MM-dd"),
    po: s.po_number || "",
    referenceNumber: s.reference_number || "",
    currency: s.currency || "USD",
    seller: s.seller || SELLER,
    buyer: s.buyer || BUYER,
    shipToFromReport: s.ship_to || "",
    reportTotals: s.report_totals || {},
    items: (s.items || []).map((i) => ({
      ...i,
      gross_weight_per_carton: i.cases ? (i.gross_weight_kg || 0) / i.cases : 0,
      net_weight_per_carton: i.cases ? (i.net_weight_kg || 0) / i.cases : 0,
      confidence: i.matched ? "high" : "none",
      warehouse_item_number: i.warehouse_item_number || "",
    })),
    totalCartons: s.total_cases || 0,
    totalValue: s.total_value || 0,
    totalGrossWeight: s.total_gross_weight || 0,
    totalNetWeight: s.total_net_weight || 0,
    logoUrl: appSettings.show_logo_on_documents ? appSettings.logo_url : null,
  });

  /* ===== Parse & Match ===== */
  const handleParseStatus = (s) => {
    if (s.phase === "done") {
      setParseStatus("Used: Gemini API");
    } else if (s.message) {
      setParseStatus(s.message);
    }
  };

  const handleParseAndMatch = async () => {
    setError("");
    setLoading(true);
    setParseStatus("");
    try {
      let shipment, lineItems;

      if (inputMode === "paste" && pastedText) {
        const parsed = parseWarehouseReport(pastedText);
        if (!parsed) {
          setError(
            "Could not parse the pasted text. Make sure it contains a tab-delimited table with column headers (e.g. ItemNumber, PurchaseOrderNumber)."
          );
          setLoading(false);
          return;
        }
        shipment = parsed.shipment;
        lineItems = parsed.lineItems;
      } else if (inputMode === "upload" && uploadedFile) {
        if (uploadedFile.type === "application/pdf") {
          const { file_url } = await uploadFile({ file: uploadedFile });
          const result = await invokeLLM({
            prompt: `Extract shipment information and line items from this Brendamour warehouse shipment report.
Return:
- transactionNumber, referenceNumber, purchaseOrderNumber
- shipToCompany, shipToAddress, shipToCity, shipToState, shipToZip, shipToCountry
- totalCartons, totalPallets, totalWeight (as strings)
- lineItems: array of { itemNumber (the product description/SKU string), quantityShipped (number of CASES), lotNumber }
Extract EVERY line item.`,
            file_urls: [file_url],
            filename: uploadedFile.name,
            onStatus: handleParseStatus,
            response_json_schema: {
              type: "object",
              properties: {
                transactionNumber: { type: "string" },
                referenceNumber: { type: "string" },
                purchaseOrderNumber: { type: "string" },
                shipToCompany: { type: "string" },
                shipToAddress: { type: "string" },
                shipToCity: { type: "string" },
                shipToState: { type: "string" },
                shipToZip: { type: "string" },
                shipToCountry: { type: "string" },
                totalCartons: { type: "string" },
                totalPallets: { type: "string" },
                totalWeight: { type: "string" },
                lineItems: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      itemNumber: { type: "string" },
                      quantityShipped: { type: "number" },
                      lotNumber: { type: "string" },
                    },
                  },
                },
              },
            },
          });
          shipment = {
            transactionNumber: result.transactionNumber || "",
            referenceNumber: result.referenceNumber || "",
            purchaseOrderNumber: result.purchaseOrderNumber || "",
            shipToCompany: result.shipToCompany || "",
            shipToAddress: result.shipToAddress || "",
            shipToCity: result.shipToCity || "",
            shipToState: result.shipToState || "",
            shipToZip: result.shipToZip || "",
            shipToCountry: result.shipToCountry || "",
            totalCartons: result.totalCartons || "",
            totalPallets: result.totalPallets || "",
            totalWeight: result.totalWeight || "",
          };
          lineItems = (result.lineItems || [])
            .map((li, idx) => ({
              index: idx,
              itemNumber: li.itemNumber || "",
              quantityShipped: li.quantityShipped || 0,
              lotNumber: li.lotNumber || "",
            }))
            .filter((li) => li.itemNumber);
        } else {
          const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(uploadedFile);
          });
          const parsed = parseWarehouseReport(text);
          if (!parsed) {
            setError("Could not parse the file. Make sure it contains a tab-delimited table with column headers.");
            setLoading(false);
            return;
          }
          shipment = parsed.shipment;
          lineItems = parsed.lineItems;
        }
      } else {
        setError("Please paste text or upload a file first.");
        setLoading(false);
        return;
      }

      if (lineItems.length === 0) {
        setError("No line items found in the report.");
        setLoading(false);
        return;
      }

      // Combine items with same ItemNumber
      const combined = {};
      lineItems.forEach((li) => {
        const key = li.itemNumber;
        if (!combined[key]) combined[key] = { ...li, quantityShipped: 0, lotNumbers: [] };
        combined[key].quantityShipped += li.quantityShipped;
        if (li.lotNumber && !combined[key].lotNumbers.includes(li.lotNumber))
          combined[key].lotNumbers.push(li.lotNumber);
      });
      const combinedItems = Object.values(combined);

      // Match to products via LLM
      const catalog = products.map((p) => ({
        id: p.id,
        description: p.description,
        item_number: p.item_number,
        upc_code: p.upc_code,
      }));

      const matchResult = await invokeLLM({
        onStatus: handleParseStatus,
        prompt: `Match each warehouse line item to the best matching product in the catalog.

Warehouse line items:
${JSON.stringify(combinedItems.map((li, idx) => ({ index: idx, itemNumber: li.itemNumber, qty: li.quantityShipped })))}

Product catalog:
${JSON.stringify(catalog)}

The warehouse itemNumber format is like "CS SLIM 750-6PK SF VANILLA CARAMEL CREAM" which means "Case, Slim brand, 750ml 6-pack, Sugar Free, Vanilla Caramel Creme flavor". Match it to the corresponding product by comparing flavor, brand, size, and pack.

Return a JSON object with a "matches" array. For each line item:
- index: the index (0-based, matching the input array)
- product_id: the matched product's id, or null if no match
- confidence: "high", "medium", or "low"
Return ALL line items, even unmatched ones (use null for product_id).`,
        response_json_schema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  product_id: { type: "string" },
                  confidence: { type: "string" },
                },
              },
            },
          },
        },
      });

      const matches = matchResult.matches || [];
      const invoiceItems = combinedItems.map((li, idx) => {
        const match = matches.find((m) => m.index === idx);
        const product = match?.product_id ? productById[match.product_id] : null;
        const cases = li.quantityShipped;
        const unitPrice = product?.unit_price_usd || 0;
        const totalAmount = cases * unitPrice;
        const grossPerCarton = product?.carton_gross_weight_kg || 0;
        const netPerCarton = product?.carton_net_weight_kg || 0;
        return {
          upc: product?.upc_code || "",
          description: product?.description || li.itemNumber,
          cases,
          unit_price: unitPrice,
          total_amount: totalAmount,
          hs_code: product?.hs_code || "",
          country_of_origin: product?.country_of_origin || "",
          gross_weight_per_carton: grossPerCarton,
          net_weight_per_carton: netPerCarton,
          gross_weight_kg: grossPerCarton * cases,
          net_weight_kg: netPerCarton * cases,
          lot_number: li.lotNumbers.join(", "),
          matched: !!product,
          confidence: match?.confidence || "none",
          warehouse_item_number: li.itemNumber,
          product_id: product?.id || null,
        };
      });

      const totalCartons = invoiceItems.reduce((s, i) => s + (parseFloat(i.cases) || 0), 0);
      const totalValue = invoiceItems.reduce((s, i) => s + (parseFloat(i.total_amount) || 0), 0);
      const totalGross = invoiceItems.reduce((s, i) => s + (parseFloat(i.gross_weight_kg) || 0), 0);
      const totalNet = invoiceItems.reduce((s, i) => s + (parseFloat(i.net_weight_kg) || 0), 0);

      const data = {
        invoiceNumber: shipment.transactionNumber || shipment.purchaseOrderNumber || "",
        invoiceDate: format(new Date(), "MM/dd/yyyy"),
        ship_date: format(new Date(), "yyyy-MM-dd"),
        po: shipment.purchaseOrderNumber || "",
        referenceNumber: shipment.referenceNumber || "",
        currency: "USD",
        seller: SELLER,
        buyer: BUYER,
        shipToFromReport: [
          shipment.shipToCompany,
          shipment.shipToAddress,
          [shipment.shipToCity, shipment.shipToState, shipment.shipToZip].filter(Boolean).join(", "),
          shipment.shipToCountry,
        ].filter(Boolean).join("\n"),
        reportTotals: {
          totalCartons: shipment.totalCartons,
          totalPallets: shipment.totalPallets,
          totalWeight: shipment.totalWeight,
        },
        items: invoiceItems,
        totalCartons,
        totalValue,
        totalGrossWeight: totalGross,
        totalNetWeight: totalNet,
        logoUrl: appSettings.show_logo_on_documents ? appSettings.logo_url : null,
      };

      setInvoiceData(data);
      setDocType("invoice");

      // Auto-save. The UI promises "Every shipment is saved automatically", so
      // a silent failure here is the worst kind: the user spends ten minutes
      // correcting matched items and then navigates away, losing all of it.
      try {
        const created = await base44.entities.InboundShipment.create(toEntity(data));
        setCurrentShipmentId(created.id);
        setAutoSaveError("");
        queryClient.invalidateQueries({ queryKey: ["inboundShipments"] });
      } catch (e) {
        console.error("Auto-save failed:", e);
        setAutoSaveError(
          friendlyErrorMessage(e, "This shipment could not be saved automatically.") +
            " Use Save before leaving this page."
        );
      }
    } catch (e) {
      setError(e.message || "Failed to parse the report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ===== Save (manual) ===== */
  const saveShipment = async () => {
    if (!invoiceData) return;
    setSaving(true);
    setError("");
    try {
      const entityData = toEntity(invoiceData);
      if (currentShipmentId) {
        await base44.entities.InboundShipment.update(currentShipmentId, entityData);
      } else {
        const created = await base44.entities.InboundShipment.create(entityData);
        setCurrentShipmentId(created.id);
      }
      queryClient.invalidateQueries({ queryKey: ["inboundShipments"] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setError("Failed to save shipment: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  /* ===== Load saved ===== */
  const loadShipment = (s) => {
    setInvoiceData(fromEntity(s));
    setCurrentShipmentId(s.id);
    setDocType("invoice");
    setView("new");
  };

  /* ===== Delete saved ===== */
  const deleteShipment = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this shipment?")) return;
    try {
      await base44.entities.InboundShipment.delete(id);
      queryClient.invalidateQueries({ queryKey: ["inboundShipments"] });
      if (currentShipmentId === id) handleReset();
    } catch (e) {
      setError("Failed to delete: " + (e.message || e));
    }
  };

  /* ===== Item editing ===== */
  const recalcTotals = (items) => {
    const totalCartons = items.reduce((s, i) => s + (parseFloat(i.cases) || 0), 0);
    const totalValue = items.reduce((s, i) => s + (parseFloat(i.total_amount) || 0), 0);
    const totalGross = items.reduce((s, i) => s + (parseFloat(i.gross_weight_kg) || 0), 0);
    const totalNet = items.reduce((s, i) => s + (parseFloat(i.net_weight_kg) || 0), 0);
    return { totalCartons, totalValue, totalGrossWeight: totalGross, totalNetWeight: totalNet };
  };

  const updateItem = (idx, key, val) => {
    setInvoiceData((d) => {
      const items = [...d.items];
      let item = { ...items[idx], [key]: val };
      if (["cases", "unit_price"].includes(key)) {
        item.cases = parseFloat(item.cases) || 0;
        item.unit_price = parseFloat(item.unit_price) || 0;
        item.total_amount = item.cases * item.unit_price;
        item.gross_weight_kg = item.cases * (parseFloat(item.gross_weight_per_carton) || 0);
        item.net_weight_kg = item.cases * (parseFloat(item.net_weight_per_carton) || 0);
      }
      items[idx] = item;
      return { ...d, items, ...recalcTotals(items) };
    });
  };

  const updateHeader = (key, val) => setInvoiceData((d) => ({ ...d, [key]: val }));

  const removeItem = (idx) => {
    setInvoiceData((d) => {
      const items = d.items.filter((_, i) => i !== idx);
      return { ...d, items, ...recalcTotals(items) };
    });
  };

  /* ===== PDF Download ===== */
  const handleDownloadPdf = async () => {
    const { default: html2canvas } = await import("html2canvas");
    const { jsPDF } = await import("jspdf");
    const elId = docType === "invoice" ? "invoice-preview" : "verification-preview";
    const el = document.getElementById(elId);
    if (!el) return;

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentW = pageW - margin * 2;

    const canvas = await html2canvas(el, { scale: 1.5, useCORS: true, logging: false, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.85);
    const imgH = (canvas.height * contentW) / canvas.width;
    const pageContentH = pageH - margin * 2;

    // FIX: the previous version redrew the same full image at the same
    // position on every page, so pages 2+ just repeated page 1's content
    // instead of continuing where the last page left off. The correct
    // pattern is to draw the SAME full-height image every time, but shift
    // its y-position up by one page's worth of height on each iteration —
    // that "scrolls" a different vertical band into the visible page area.
    addPaginatedImage(pdf, imgData, { margin });

    const filename =
      docType === "invoice"
        ? `CommercialInvoice_${invoiceData.po || invoiceData.invoiceNumber || "document"}.pdf`
        : `VerificationSheet_${invoiceData.po || invoiceData.invoiceNumber || "document"}.pdf`;
    pdf.save(filename);
  };

  const handleReset = () => {
    setInvoiceData(null);
    setCurrentShipmentId(null);
    setPastedText("");
    setUploadedFile(null);
    setError("");
    setDocType("invoice");
  };

  const matchedCount = invoiceData?.items?.filter((i) => i.matched).length || 0;
  const unmatchedCount = invoiceData ? invoiceData.items.length - matchedCount : 0;

  const filteredShipments = savedShipments.filter((s) => {
    if (!savedSearch) return true;
    const q = savedSearch.toLowerCase();
    return (
      (s.po_number || "").toLowerCase().includes(q) ||
      (s.transaction_number || "").toLowerCase().includes(q) ||
      (s.reference_number || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header bar */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Commercial Invoice Generator</h1>
        {invoiceData && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveShipment} disabled={saving || !invoiceData}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : savedFlash ? (
                <CheckCircle className="w-4 h-4 mr-1 text-green-600" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              {saving ? "Saving…" : savedFlash ? "Saved!" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownloadPdf} className="border-gray-300 text-gray-700 hover:bg-gray-50">
              <Download className="w-4 h-4 mr-1" /> PDF
            </Button>
            <Button size="sm" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
            <Button size="sm" variant="outline" onClick={handleReset} className="text-gray-500">
              <RefreshCw className="w-4 h-4 mr-1" /> New
            </Button>
          </div>
        )}
      </div>

      {/* Input / Saved list section */}
      {!invoiceData && (
        <div className="p-6 max-w-3xl mx-auto w-full no-print">
          {/* View tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setView("new")}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${view === "new" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
            >
              New Shipment
            </button>
            <button
              onClick={() => setView("saved")}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${view === "saved" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
            >
              Saved Shipments ({savedShipments.length})
            </button>
          </div>

          {view === "new" ? (
            <div className="bg-white border rounded-xl p-6 shadow-sm">
              <p className="text-sm text-gray-500 mb-4">
                Paste the tab-delimited "Export Content" from the Brendamour warehouse shipment email, or upload the
                attached file. Items will be auto-matched to your product catalog. Every shipment is saved automatically.
              </p>

              {/* Mode tabs */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setInputMode("paste")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border ${inputMode === "paste" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
                >
                  Paste Text
                </button>
                <button
                  onClick={() => setInputMode("upload")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border ${inputMode === "upload" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
                >
                  Upload File
                </button>
              </div>

              {inputMode === "paste" ? (
                <Textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={10}
                  placeholder="Paste the tab-delimited Export Content here…"
                  className="font-mono text-xs"
                />
              ) : (
                <div
                  className={`flex items-center gap-2 border-2 border-dashed rounded-lg px-4 py-8 cursor-pointer transition-colors ${uploadedFile ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f) setUploadedFile(f);
                  }}
                >
                  <Upload className="w-6 h-6 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-600">
                    {uploadedFile ? uploadedFile.name : "Drop or click to upload the report file (PDF, TXT, CSV)"}
                  </span>
                  {uploadedFile && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFile(null);
                      }}
                      className="ml-auto"
                    >
                      <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.csv,.tsv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files[0];
                  if (f) setUploadedFile(f);
                }}
              />

              {parseStatus && (
                <div className="flex items-center gap-2 mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">
                  <Sparkles className="w-4 h-4 flex-shrink-0" />
                  {parseStatus}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {autoSaveError && (
                <div className="flex items-center gap-2 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {autoSaveError}
                </div>
              )}

              <div className="flex items-center gap-3 mt-4">
                <Button
                  onClick={handleParseAndMatch}
                  disabled={loading || (inputMode === "paste" ? !pastedText : !uploadedFile) || products.length === 0}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Parsing &amp; Matching…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-1" /> Parse &amp; Match
                    </>
                  )}
                </Button>
                {productsLoading && (
                  <span className="text-xs text-amber-600">Loading product catalog…</span>
                )}
                {productsFailed && (
                  <span className="text-xs text-red-600">
                    {friendlyErrorMessage(productsError, "Could not load the product catalog.")}{" "}
                    <button onClick={() => refetchProducts()} className="underline">Retry</button>
                  </span>
                )}
                {!productsLoading && !productsFailed && products.length === 0 && (
                  <span className="text-xs text-amber-600">
                    No products in the catalog yet — add products before matching.
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border rounded-xl p-6 shadow-sm">
              {/* Search */}
              <div className="flex items-center gap-2 mb-4">
                <Search className="w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search by PO, transaction, or reference number…"
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  className="h-9"
                />
              </div>

              {filteredShipments.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  {savedShipments.length === 0 ? "No saved shipments yet." : "No matching shipments."}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredShipments.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => loadShipment(s)}
                      className="flex items-center gap-3 border rounded-lg p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-gray-900">
                            {s.po_number || s.transaction_number || "—"}
                          </span>
                          {s.status === "verified" && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">verified</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {s.transaction_number && `Txn: ${s.transaction_number} · `}
                          {formatDate(s.ship_date, "MMM d, yyyy", "No date")} ·{" "}
                          {s.total_cases || 0} cases · ${(s.total_value || 0).toFixed(2)} {s.currency || "USD"}
                        </div>
                      </div>
                      <button
                        onClick={(e) => deleteShipment(s.id, e)}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Review + Preview */}
      {invoiceData && (
        <div className="flex flex-1 overflow-hidden print-overflow">
          {/* Review panel */}
          <div className="w-1/2 overflow-y-auto p-4 no-print border-r">
            {/* Match summary */}
            <div className="flex items-center gap-3 mb-4">
              {unmatchedCount > 0 ? (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {unmatchedCount} unmatched item{unmatchedCount !== 1 ? "s" : ""} — review below
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-green-800 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  All {matchedCount} items matched
                </div>
              )}
            </div>

            {/* Header fields */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <Label className="text-xs text-gray-500">Invoice Number</Label>
                <Input
                  value={invoiceData.invoiceNumber}
                  onChange={(e) => updateHeader("invoiceNumber", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Invoice Date</Label>
                <Input
                  value={invoiceData.invoiceDate}
                  onChange={(e) => updateHeader("invoiceDate", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">PO Number</Label>
                <Input
                  value={invoiceData.po}
                  onChange={(e) => updateHeader("po", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Reference Number</Label>
                <Input
                  value={invoiceData.referenceNumber}
                  onChange={(e) => updateHeader("referenceNumber", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Ship Date</Label>
                <Input
                  type="date"
                  value={invoiceData.ship_date || ""}
                  onChange={(e) => updateHeader("ship_date", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
            </div>

            {/* Ship-to from report */}
            {invoiceData.shipToFromReport && (
              <div className="mb-4 bg-gray-50 border rounded-lg p-3">
                <Label className="text-xs text-gray-500">Ship-To (from warehouse report)</Label>
                <p className="text-xs text-gray-700 mt-1 whitespace-pre-line">{invoiceData.shipToFromReport}</p>
              </div>
            )}

            {/* Items table */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">Match</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">Description</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">Cases</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">USD/Case</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">Total</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b">HS Code</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-gray-600 border-b"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoiceData.items.map((item, idx) => (
                    <tr key={idx} className={item.matched ? "" : "bg-red-50"}>
                      <td className="px-2 py-1">
                        {item.matched ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        )}
                      </td>
                      <td className="px-1 py-1 min-w-[160px]">
                        <Input
                          value={item.description || ""}
                          onChange={(e) => updateItem(idx, "description", e.target.value)}
                          className="h-6 text-xs px-1"
                        />
                        {!item.matched && (
                          <p className="text-[10px] text-red-400 mt-0.5 truncate" title={item.warehouse_item_number}>
                            ⚠ {item.warehouse_item_number}
                          </p>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          type="number"
                          value={item.cases || ""}
                          onChange={(e) => updateItem(idx, "cases", e.target.value)}
                          className="h-6 text-xs px-1 w-14"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          type="number"
                          value={item.unit_price || ""}
                          onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
                          className="h-6 text-xs px-1 w-20"
                        />
                      </td>
                      <td className="px-1 py-1 text-right text-xs font-medium w-20">
                        {(item.total_amount || 0).toFixed(2)}
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          value={item.hs_code || ""}
                          onChange={(e) => updateItem(idx, "hs_code", e.target.value)}
                          className="h-6 text-xs px-1 w-24"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals summary */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white border rounded-lg p-3">
                <span className="text-xs text-gray-500">Total Invoice Value</span>
                <div className="text-lg font-bold text-gray-900">
                  {invoiceData.currency} {invoiceData.totalValue.toFixed(2)}
                </div>
              </div>
              <div className="bg-white border rounded-lg p-3">
                <span className="text-xs text-gray-500">Total Cases / Gross Weight</span>
                <div className="text-sm font-semibold text-gray-700">
                  {invoiceData.totalCartons} cases · {invoiceData.totalGrossWeight.toFixed(1)} kg
                </div>
              </div>
            </div>
          </div>

          {/* Preview panel */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-100 print-overflow">
            {/* Document toggle */}
            <div className="flex gap-2 mb-3 no-print">
              <button
                onClick={() => setDocType("invoice")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border ${docType === "invoice" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
              >
                <FileText className="w-4 h-4" /> Commercial Invoice
              </button>
              <button
                onClick={() => setDocType("verification")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border ${docType === "verification" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
              >
                <ClipboardCheck className="w-4 h-4" /> Verification Sheet
              </button>
            </div>

            <div className="max-w-4xl mx-auto bg-white shadow-lg rounded">
              {docType === "invoice" ? (
                <div id="invoice-preview">
                  <BrendamourInvoiceDoc data={invoiceData} />
                </div>
              ) : (
                <div id="verification-preview">
                  <InboundVerificationDoc data={invoiceData} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .print-overflow { overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}