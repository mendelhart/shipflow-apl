import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Sparkles, Upload, CheckCircle, RefreshCw, AlertTriangle, Mail } from "lucide-react";
import EmailAplDialog from "@/components/po/EmailAplDialog";
import { formatPoNumber } from "@/utils/poNumber";
import { invokeLLM, uploadFile } from "@/lib/aiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useNavigate } from "react-router-dom";
import { friendlyErrorMessage } from "@/lib/errors";
import { bumpStatus } from "@/domain/poStatus";

const EMPTY_PO = { po_number: "", po_prefix: "50", dept_number: "81", vendor_id: "", invoice_number: "", invoice_date: "", freight_terms: "EXW", currency: "CAD", ship_date: "", cancel_date: "", status: "draft", notes: "", items: [], container_number: "", seal_number: "", total_cartons: 0, total_pallets: 0, total_gross_weight_kg: 0, total_net_weight_kg: 0, total_cbm: 0, load_type: "FCL", pre_ticketed: false, store_ready: false, apl_booking_number: "", exporter_name: "Mendel Hart", exporter_title: "" };

const EMPTY_ITEM = { product_id: "", item_number: "", vendor_style: "", description: "", upc_code: "", hs_code: "2106.90.99.98", schedule_b: "2106.90.99.98", country_of_origin: "USA", unit_price: 0, units_per_carton: 6, num_cartons: 0, total_units: 0, gross_weight_kg: 5.0, net_weight_kg: 5.1, cbm: 0.015, size: "750ml" };

const AUTO_SPECS = { gross_weight_kg: 5.0, net_weight_kg: 5.1, cbm: 0.015 };

// Same 402/403 classification used across the other pages/components.


export default function POForm({ po, onClose }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  // FIX: guard against `po` itself being a malformed/partial object (e.g. a
  // stale cached record missing fields) — spreading EMPTY_PO first and
  // explicitly defaulting items to an array either way means every field
  // this form reads always has a safe value, regardless of what shape the
  // incoming `po` prop actually has.
  const [form, setForm] = useState(() => (po ? { ...EMPTY_PO, ...po, items: Array.isArray(po.items) ? po.items : [], exporter_name: po.exporter_name || EMPTY_PO.exporter_name } : { ...EMPTY_PO }));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiFile, setAiFile] = useState(null);
  const [aiPreview, setAiPreview] = useState(null);
  const fileInputRef = useRef(null);
  const [saved, setSaved] = useState(!!po?.id);
  const [saveError, setSaveError] = useState("");
  const [savedId, setSavedId] = useState(po?.id || null);
  const savedIdRef = useRef(po?.id || null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [showAplEmail, setShowAplEmail] = useState(false);

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });
  const { data: settingsList = [] } = useQuery({ queryKey: ["appsettings"], queryFn: () => base44.entities.AppSettings.list() });
  const appSettings = settingsList[0] || {};

  // For a brand-new PO (not editing an existing one), default the exporter
  // name/title from the org-wide Signing Authority setting once it loads,
  // rather than the hardcoded fallback — but never overwrite something the
  // user has already typed into these fields.
  useEffect(() => {
    if (!po && settingsList.length > 0) {
      setForm(p => ({
        ...p,
        exporter_name: p.exporter_name === EMPTY_PO.exporter_name ? (appSettings.exporter_name || EMPTY_PO.exporter_name) : p.exporter_name,
        exporter_title: !p.exporter_title ? (appSettings.exporter_title || "") : p.exporter_title,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsList]);

  useEffect(() => {
    if (!form.vendor_id && vendors.length > 0) {
      const def = vendors.find(v => v.is_default) || vendors[0];
      if (def) setForm(p => ({ ...p, vendor_id: def.id }));
    }
  }, [vendors]);

  const save = useMutation({
    mutationFn: (data) => {
      // Every save applies the same auto-status rule: if a booking # is
      // present, the PO is at least "booked" — but never downgrades a PO
      // that's already further along (e.g. already shipped/invoiced via
      // SCLP or the TJX Europe invoice flow).
      const withStatus = {
        ...data,
        status: data.apl_booking_number ? bumpStatus(data.status, "booked") : (data.status || "draft"),
      };
      return savedIdRef.current
        ? base44.entities.PurchaseOrder.update(savedIdRef.current, withStatus)
        : base44.entities.PurchaseOrder.create(withStatus);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      if (!savedIdRef.current && result?.id) {
        savedIdRef.current = result.id;
        setSavedId(result.id);
      }
      setSaved(true);
      setSaveError("");
    },
    onError: (err) => {
      setSaveError(friendlyErrorMessage(err, "Failed to save this PO. Please try again."));
    },
  });

  const f = (k) => (e) => { setSaved(false); setForm(p => ({ ...p, [k]: e.target.value })); };
  const fn = (k) => (e) => { setSaved(false); setForm(p => ({ ...p, [k]: parseFloat(e.target.value) || 0 })); };
  const fv = (k) => (v) => { setSaved(false); setForm(p => ({ ...p, [k]: v })); };

  const addItem = () => { setSaved(false); setForm(p => ({ ...p, items: [...(p.items || []), { ...EMPTY_ITEM }] })); };

  const updateItem = (idx, key, val) => {
    setSaved(false);
    setForm(p => {
      const items = [...(p.items || [])];
      items[idx] = { ...items[idx], [key]: val };
      const n = parseFloat(key === "num_cartons" ? val : items[idx].num_cartons) || 0;
      const u = parseFloat(key === "units_per_carton" ? val : items[idx].units_per_carton) || 0;
      items[idx].total_units = n * u;
      const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
      const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
      const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
      const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);
      const totalPallets = Math.ceil(totalCartons / 126);
      return { ...p, items, total_cartons: totalCartons, total_gross_weight_kg: parseFloat(totalGross.toFixed(2)), total_net_weight_kg: parseFloat(totalNet.toFixed(2)), total_cbm: parseFloat(totalCbm.toFixed(6)), total_pallets: totalPallets };
    });
  };

  const fillFromProduct = (idx, productId) => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;
    setSaved(false);
    const items = [...(form.items || [])];
    if (!items[idx]) return;
    const grossKg = prod.carton_gross_weight_kg || AUTO_SPECS.gross_weight_kg;
    const netKg = prod.carton_net_weight_kg || AUTO_SPECS.net_weight_kg;
    const cbm = prod.carton_cbm || AUTO_SPECS.cbm;
    const numCartons = items[idx].num_cartons || 0;
    const unitsPerCarton = prod.units_per_carton || 6;
    items[idx] = {
      ...items[idx],
      product_id: productId,
      item_number: prod.item_number || items[idx].item_number || "",
      vendor_style: prod.vendor_style || prod.item_number || items[idx].vendor_style || "",
      description: prod.description || items[idx].description || "",
      upc_code: prod.upc_code || items[idx].upc_code || "",
      hs_code: prod.hs_code || items[idx].hs_code || "2106.90.99.98",
      schedule_b: prod.schedule_b || prod.hs_code || items[idx].schedule_b || "2106.90.99.98",
      country_of_origin: prod.country_of_origin || items[idx].country_of_origin || "USA",
      unit_price: prod.unit_price_cad || prod.unit_price_usd || items[idx].unit_price || 0,
      units_per_carton: unitsPerCarton,
      size: prod.size || items[idx].size || "750ml",
      gross_weight_kg: grossKg,
      net_weight_kg: netKg,
      cbm,
      total_units: numCartons * unitsPerCarton,
    };
    const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
    const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
    const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
    const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);
    const updated = { ...form, items, total_cartons: totalCartons, total_gross_weight_kg: parseFloat(totalGross.toFixed(2)), total_net_weight_kg: parseFloat(totalNet.toFixed(2)), total_cbm: parseFloat(totalCbm.toFixed(6)), total_pallets: Math.ceil(totalCartons / 126) };
    setForm(updated);
    if (savedIdRef.current) {
      base44.entities.PurchaseOrder.update(savedIdRef.current, updated)
        .then(() => { qc.invalidateQueries({ queryKey: ["pos"] }); setSaved(true); })
        .catch((err) => setSaveError(friendlyErrorMessage(err, "Failed to save catalog link.")));
    }
  };

  const removeItem = (idx) => {
    setSaved(false);
    setForm(p => {
      const items = (p.items || []).filter((_, i) => i !== idx);
      const totalCartons = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0);
      const totalGross = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0);
      const totalNet = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0);
      const totalCbm = items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0);
      const totalPallets = Math.ceil(totalCartons / 126);
      return { ...p, items, total_cartons: totalCartons, total_gross_weight_kg: parseFloat(totalGross.toFixed(2)), total_net_weight_kg: parseFloat(totalNet.toFixed(2)), total_cbm: parseFloat(totalCbm.toFixed(6)), total_pallets: totalPallets };
    });
  };

  // FIX: previously had NO try/catch at all — a failed UploadFile or
  // InvokeLLM call (network blip, or the same 402 out-of-credits case seen
  // elsewhere in this app) would throw as an unhandled promise rejection,
  // silently leaving aiLoading stuck or the UI in a confusing state with no
  // visible error message.
  const handleAiImport = async () => {
    if (!aiFile) return;
    setAiLoading(true);
    setAiError("");
    try {
      const { file_url } = await uploadFile({ file: aiFile });
      const result = await invokeLLM({
        prompt: `You are a precise data extractor for TJX Purchase Order documents.

CRITICAL RULES — follow exactly:
1. Extract ONLY the line items that are explicitly listed in the document. Do NOT add, infer, or invent items.
2. For quantities: read num_cartons AND total_units DIRECTLY from the document as printed. Do NOT calculate or derive them.
3. If a field is not clearly visible in the document, leave it as an empty string or 0 — never guess.

Extract the following fields:
- po_number (string, e.g. "50 586301" — include the prefix)
- po_prefix (string, "50" or "55")
- dept_number (string)
- freight_terms (string: "FOB" or "EXW" — normalize "Ex-Works" to "EXW")
- currency (string, e.g. "CAD")
- ship_date (YYYY-MM-DD, from "Start Ship Date" field)
- cancel_date (YYYY-MM-DD, from "Cancel if not received" field)
- items: array — one entry per line item row in the document, with:
    - item_number (the vendor style / item number column)
    - description (the description column)
    - total_units (the "Units" column value as printed — REQUIRED, read directly)
    - units_per_carton (the "Pack Size" column value if shown and non-empty; otherwise leave as 0)
    - num_cartons (number of cartons if explicitly shown; otherwise leave as 0 — it will be calculated)
    - unit_price (unit cost / local cost in CAD)`,
        file_urls: [file_url],
        response_json_schema: {
          type: "object",
          properties: {
            po_number: { type: "string" },
            po_prefix: { type: "string" },
            dept_number: { type: "string" },
            freight_terms: { type: "string" },
            currency: { type: "string" },
            ship_date: { type: "string" },
            cancel_date: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item_number: { type: "string" },
                  description: { type: "string" },
                  num_cartons: { type: "number" },
                  units_per_carton: { type: "number" },
                  total_units: { type: "number" },
                  unit_price: { type: "number" }
                }
              }
            }
          }
        }
      });

      let rawPoNumber = result.po_number || "";
      let rawPoPrefix = result.po_prefix || "";
      if (rawPoNumber.startsWith("50 ") || rawPoNumber.startsWith("55 ")) {
        rawPoPrefix = rawPoNumber.substring(0, 2);
        rawPoNumber = rawPoNumber.substring(3).trim();
      }

      const mappedItems = (result.items || []).map(ai => {
        const prod = products.find(p => p.item_number === ai.item_number || p.item_number === String(ai.item_number) || p.vendor_style === ai.item_number);
        const totalUnits = ai.total_units || 0;
        const unitsPerCarton = ai.units_per_carton > 0 ? ai.units_per_carton : (prod?.units_per_carton || 6);
        const numCartons = ai.num_cartons > 0 ? ai.num_cartons : (totalUnits > 0 && unitsPerCarton > 0 ? Math.round(totalUnits / unitsPerCarton) : 0);
        return {
          product_id: prod?.id || "",
          item_number: prod?.item_number || ai.item_number || "",
          vendor_style: prod?.vendor_style || ai.item_number || "",
          description: prod?.description || ai.description || "",
          upc_code: prod?.upc_code || "",
          hs_code: prod?.hs_code || "2106.90.99.98",
          schedule_b: prod?.schedule_b || prod?.hs_code || "2106.90.99.98",
          country_of_origin: prod?.country_of_origin || "USA",
          unit_price: ai.unit_price || prod?.unit_price_cad || prod?.unit_price_usd || 0,
          units_per_carton: unitsPerCarton,
          num_cartons: numCartons,
          total_units: totalUnits,
          gross_weight_kg: prod?.carton_gross_weight_kg || AUTO_SPECS.gross_weight_kg,
          net_weight_kg: prod?.carton_net_weight_kg || AUTO_SPECS.net_weight_kg,
          cbm: prod?.carton_cbm || AUTO_SPECS.cbm,
          size: prod?.size || "750ml",
        };
      });

      setAiPreview({
        po_number: rawPoNumber,
        po_prefix: rawPoPrefix,
        dept_number: result.dept_number || "",
        freight_terms: (result.freight_terms || "EXW").includes("Work") ? "EXW" : (result.freight_terms || "EXW"),
        currency: result.currency || "CAD",
        ship_date: result.ship_date || "",
        cancel_date: result.cancel_date || "",
        items: mappedItems,
      });
      setAiFile(null);
    } catch (err) {
      setAiError(friendlyErrorMessage(err, "Failed to extract data from this document. Please try again."));
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiPreview = async () => {
    if (!aiPreview) return;
    const { items: mappedItems, ...headerFields } = aiPreview;
    const totalCartons = mappedItems.reduce((s, i) => s + (i.num_cartons || 0), 0);
    const totalGross = mappedItems.reduce((s, i) => s + (i.num_cartons || 0) * (i.gross_weight_kg || 0), 0);
    const totalNet = mappedItems.reduce((s, i) => s + (i.num_cartons || 0) * (i.net_weight_kg || 0), 0);
    const totalCbm = mappedItems.reduce((s, i) => s + (i.num_cartons || 0) * (i.cbm || 0), 0);
    setForm(p => ({ ...p, ...headerFields, items: mappedItems, total_cartons: totalCartons, total_gross_weight_kg: parseFloat(totalGross.toFixed(2)), total_net_weight_kg: parseFloat(totalNet.toFixed(2)), total_cbm: parseFloat(totalCbm.toFixed(6)), total_pallets: Math.ceil(totalCartons / 126) }));
    setSaved(false);
    setAiPreview(null);
    try {
      await syncProductsFromPO(mappedItems);
    } catch (err) {
      setAiError(friendlyErrorMessage(err, "Applied to PO, but syncing to the product catalog failed."));
    }
  };

  const handleAiImportSafe = async () => {
    await handleAiImport();
  };

  const goToDocuments = (type) => {
    if (!savedIdRef.current) return;
    navigate(`/${type}?po=${savedIdRef.current}`);
  };

  const syncProductsFromPO = async (items) => {
    const itemsToSync = items || form.items || [];
    if (!itemsToSync.length) return;
    setSyncStatus("syncing");
    try {
      for (const item of itemsToSync) {
        const prod = products.find(p => p.id === item.product_id || (item.item_number && p.item_number === item.item_number));
        if (prod) {
          const updates = {};
          if (item.upc_code && item.upc_code !== prod.upc_code) updates.upc_code = item.upc_code;
          if (item.hs_code && item.hs_code !== prod.hs_code) updates.hs_code = item.hs_code;
          if (item.schedule_b && item.schedule_b !== prod.schedule_b) updates.schedule_b = item.schedule_b;
          if (item.unit_price && item.unit_price !== prod.unit_price_usd) updates.unit_price_usd = item.unit_price;
          if (item.units_per_carton && item.units_per_carton !== prod.units_per_carton) updates.units_per_carton = item.units_per_carton;
          if (item.gross_weight_kg && item.gross_weight_kg !== prod.carton_gross_weight_kg) updates.carton_gross_weight_kg = item.gross_weight_kg;
          if (item.net_weight_kg && item.net_weight_kg !== prod.carton_net_weight_kg) updates.carton_net_weight_kg = item.net_weight_kg;
          if (item.cbm && item.cbm !== prod.carton_cbm) updates.carton_cbm = item.cbm;
          if (item.size && item.size !== prod.size) updates.size = item.size;
          if (item.description && !prod.description) updates.description = item.description;
          if (item.country_of_origin && item.country_of_origin !== prod.country_of_origin) updates.country_of_origin = item.country_of_origin;
          if (Object.keys(updates).length > 0) await base44.entities.Product.update(prod.id, updates);
        }
      }
      qc.invalidateQueries({ queryKey: ["products"] });
      setSyncStatus("done");
      setTimeout(() => setSyncStatus(null), 3000);
    } catch (err) {
      setSyncStatus(null);
      throw err;
    }
  };

  const items = form.items || [];
  const vendorsSafe = vendors || [];
  const productsSafe = products || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate("/Dashboard")}><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">{savedId ? `PO ${formatPoNumber(form)}` : "New Purchase Order"}</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${step === 1 ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"}`}>1. PO Details</span>
          <span className="text-gray-400">→</span>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${step === 2 ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"}`}>2. Shipping</span>
        </div>
        <Button size="sm" onClick={() => save.mutate(form)} disabled={save.isPending} className={saved ? "bg-green-600 hover:bg-green-700" : ""}>
          {save.isPending ? "Saving..." : saved ? <><CheckCircle className="w-3 h-3 mr-1" />Saved</> : "Save PO"}
        </Button>
      </div>

      {saveError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-700">{saveError}</div>
      )}

      {/* Documents banner */}
      {savedId && (
        <>
          <div className="bg-green-50 border-b border-green-200 px-6 py-3 flex flex-wrap items-center gap-2">
            <span className="text-green-800 font-medium text-sm mr-1">✅ Documents:</span>
            {[
              { label: "Commercial Invoice", path: `/Invoices?po=${savedIdRef.current}` },
              { label: "Packing List", path: `/PackingLists?po=${savedIdRef.current}` },
              { label: "Carton Labels", path: `/Labels?po=${savedIdRef.current}` },
              { label: "SCLP", path: `/SCLP?po=${savedIdRef.current}` },
              { label: "Food Detail Checklist", path: `/FoodChecklist?po=${savedIdRef.current}` },
              { label: "Repeat Vendor FDC Approval", path: `/FoodChecklist?po=${savedIdRef.current}&mode=repeat` },
            ].map(({ label, path }) => (
              <button key={path} onClick={() => navigate(path)} className="bg-white border border-green-300 text-green-700 text-xs px-3 py-1.5 rounded-lg hover:bg-green-100">
                {label}
              </button>
            ))}
            <button onClick={() => setShowAplEmail(true)} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 flex items-center gap-1">
              <Mail className="w-3 h-3" />Email APL
            </button>
          </div>
          {form.apl_email_sent_at && (
            <div className="text-xs text-green-700 px-6 py-1 bg-green-50 border-b border-green-200">
              ✓ APL emailed {form.apl_booking_number ? `(Booking: ${form.apl_booking_number})` : ""} on {new Date(form.apl_email_sent_at).toLocaleDateString()}
            </div>
          )}
        </>
      )}

      <div className="p-6 max-w-5xl mx-auto space-y-5">

        {/* STEP 1: PO Details */}
        {step === 1 && (
          <>
            {/* AI Import */}
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h2 className="font-semibold text-purple-900">AI Auto-Import from TJX Purchase Order</h2>
              </div>
              <p className="text-sm text-purple-700 mb-2">Drop your TJX PO file here and AI will extract all items, quantities, and details automatically.</p>
              <div
                className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors mb-3 ${aiFile ? "border-purple-500 bg-purple-50" : "border-purple-300 bg-white hover:border-purple-500 hover:bg-purple-50"}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) { setAiFile(file); setAiError(""); } }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-purple-400 mb-2" />
                {aiFile ? (
                  <span className="text-sm font-medium text-purple-700">{aiFile.name}</span>
                ) : (
                  <>
                    <span className="text-sm font-medium text-purple-700">Drop file here or click to browse</span>
                    <span className="text-xs text-purple-500 mt-1">PDF, Excel, image — any TJX PO format</span>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" className="hidden" onChange={e => { const file = e.target.files[0]; if (file) { setAiFile(file); setAiError(""); } }} />
              </div>
              <div className="flex items-center gap-3">
                {aiFile && <button onClick={e => { e.stopPropagation(); setAiFile(null); setAiError(""); }} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>}
                <Button onClick={e => { e.stopPropagation(); handleAiImportSafe(); }} disabled={!aiFile || aiLoading} className="bg-purple-600 hover:bg-purple-700 ml-auto">
                  {aiLoading ? "Importing..." : <><Sparkles className="w-4 h-4 mr-1" />Import with AI</>}
                </Button>
              </div>
              {aiError && (
                <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {aiError}
                </div>
              )}
            </div>

            {/* AI Preview */}
            {aiPreview && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <h2 className="font-semibold text-amber-900">Review AI Results Before Applying</h2>
                </div>
                <p className="text-sm text-amber-700 mb-3">
                  The AI found <strong>{(aiPreview.items || []).length} line item{(aiPreview.items || []).length !== 1 ? "s" : ""}</strong>. Verify the quantities below.
                </p>
                <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
                  {aiPreview.po_number && <div><span className="text-gray-500 text-xs">PO #</span><div className="font-semibold">{aiPreview.po_prefix} {aiPreview.po_number}</div></div>}
                  {aiPreview.ship_date && <div><span className="text-gray-500 text-xs">Ship Date</span><div className="font-semibold">{aiPreview.ship_date}</div></div>}
                  {aiPreview.cancel_date && <div><span className="text-gray-500 text-xs">Cancel Date</span><div className="font-semibold">{aiPreview.cancel_date}</div></div>}
                </div>
                <div className="border rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-xs">
                    <thead className="bg-amber-100">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Item #</th>
                        <th className="text-left px-3 py-2 font-semibold">Description</th>
                        <th className="text-center px-3 py-2 font-semibold">Cartons</th>
                        <th className="text-center px-3 py-2 font-semibold">Total Units</th>
                        <th className="text-center px-3 py-2 font-semibold">Unit Price</th>
                        <th className="text-center px-3 py-2 font-semibold">Catalog Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y bg-white">
                      {(aiPreview.items || []).map((item, i) => (
                        <tr key={i} className={item.product_id ? "" : "bg-yellow-50"}>
                          <td className="px-3 py-2 font-mono">{item.item_number}</td>
                          <td className="px-3 py-2">{item.description}</td>
                          <td className="px-3 py-2 text-center font-bold text-blue-700">{item.num_cartons}</td>
                          <td className="px-3 py-2 text-center font-bold text-blue-700">{item.total_units}</td>
                          <td className="px-3 py-2 text-center">${item.unit_price}</td>
                          <td className="px-3 py-2 text-center">
                            {item.product_id ? <span className="text-green-700 font-semibold">✓ matched</span> : <span className="text-amber-600">⚠ no match</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setAiPreview(null)}>Discard</Button>
                  <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={applyAiPreview}>
                    <CheckCircle className="w-4 h-4 mr-1" /> Apply to PO
                  </Button>
                </div>
              </div>
            )}

            {/* PO Header */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-gray-800 mb-4">PO Information</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><Label className="text-xs">PO Number *</Label><Input value={form.po_number} onChange={f("po_number")} placeholder="e.g. 50 586301" className="h-8 text-sm mt-1" /></div>
                <div>
                  <Label className="text-xs">Destination</Label>
                  <Select value={form.po_prefix} onValueChange={fv("po_prefix")}>
                    <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50 – UK (London)</SelectItem>
                      <SelectItem value="55">55 – Germany (Bergheim)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Dept. No</Label><Input value={form.dept_number} onChange={f("dept_number")} className="h-8 text-sm mt-1" /></div>
                <div>
                  <Label className="text-xs">Vendor</Label>
                  <Select value={form.vendor_id} onValueChange={fv("vendor_id")}>
                    <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendorsSafe.map(v => <SelectItem key={v.id} value={v.id}>{v.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Invoice Number</Label><Input value={form.invoice_number} onChange={f("invoice_number")} placeholder="e.g. INV-001" className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Invoice Date</Label><Input type="date" value={form.invoice_date} onChange={f("invoice_date")} className="h-8 text-sm mt-1" /></div>
                <div>
                  <Label className="text-xs">Freight Terms</Label>
                  <Select value={form.freight_terms} onValueChange={fv("freight_terms")}>
                    <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FOB">FOB</SelectItem>
                      <SelectItem value="EXW">EXW (Ex-Works)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={form.currency} onValueChange={fv("currency")}>
                    <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAD">CAD</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Ship Date</Label><Input type="date" value={form.ship_date} onChange={f("ship_date")} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Cancel Date</Label><Input type="date" value={form.cancel_date} onChange={f("cancel_date")} className="h-8 text-sm mt-1" /></div>
              </div>
              <div className="flex gap-6 mt-4">
                <div className="flex items-center gap-2"><Switch checked={!!form.pre_ticketed} onCheckedChange={fv("pre_ticketed")} /><Label className="text-sm">Pre-Ticketed</Label></div>
                <div className="flex items-center gap-2"><Switch checked={!!form.store_ready} onCheckedChange={fv("store_ready")} /><Label className="text-sm">Store Ready</Label></div>
              </div>
            </div>

            {/* Line Items */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-gray-800">Line Items</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Weights are per carton (default: 5.0 kg gross, 5.1 kg net, 0.015 CBM). Override per line if needed.</p>
                </div>
                <div className="flex gap-2">
                  {items.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => syncProductsFromPO().catch((err) => setAiError(friendlyErrorMessage(err, "Sync to catalog failed.")))} disabled={syncStatus === "syncing"} className={syncStatus === "done" ? "border-green-500 text-green-700" : ""}>
                      {syncStatus === "syncing" ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Syncing...</> : syncStatus === "done" ? <>✓ Synced</> : <><RefreshCw className="w-3 h-3 mr-1" />Sync to Catalog</>}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-3 h-3 mr-1" />Add Item</Button>
                </div>
              </div>
              {items.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">Use AI import above or add items manually.</div>}
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="border rounded-lg p-3 bg-gray-50 relative">
                    <button onClick={() => removeItem(idx)} className="absolute top-2 right-2"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="col-span-2 md:col-span-4">
                        <Label className="text-xs">Product from catalog</Label>
                        <Select value={item.product_id || ""} onValueChange={v => fillFromProduct(idx, v)}>
                          <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Link to catalog product..." /></SelectTrigger>
                          <SelectContent>
                            {productsSafe.map(p => <SelectItem key={p.id} value={p.id}>{p.item_number} – {p.description}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-xs">Item #</Label><Input value={item.item_number || ""} onChange={e => updateItem(idx, "item_number", e.target.value)} className="h-8 text-sm mt-1" /></div>
                      <div className="col-span-2 md:col-span-1"><Label className="text-xs">Description</Label><Input value={item.description || ""} onChange={e => updateItem(idx, "description", e.target.value)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">UPC</Label><Input value={item.upc_code || ""} onChange={e => updateItem(idx, "upc_code", e.target.value)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">HS Code</Label><Input value={item.hs_code || ""} onChange={e => updateItem(idx, "hs_code", e.target.value)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">Schedule B</Label><Input value={item.schedule_b || ""} onChange={e => updateItem(idx, "schedule_b", e.target.value)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">COO</Label><Input value={item.country_of_origin || ""} onChange={e => updateItem(idx, "country_of_origin", e.target.value)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">Price/Unit (CAD)</Label><Input type="number" value={item.unit_price || ""} onChange={e => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">Units/Ctn</Label><Input type="number" value={item.units_per_carton || ""} onChange={e => updateItem(idx, "units_per_carton", parseFloat(e.target.value) || 6)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs">Num Cartons</Label><Input type="number" value={item.num_cartons || ""} onChange={e => updateItem(idx, "num_cartons", parseFloat(e.target.value) || 0)} className="h-8 text-sm mt-1 bg-white" /></div>
                      <div><Label className="text-xs text-blue-600">Total Units (auto)</Label><Input type="number" value={item.total_units || ""} readOnly className="h-8 text-sm mt-1 bg-blue-50 text-blue-800" /></div>
                      <div><Label className="text-xs text-green-600">Gross kg/Carton</Label><Input type="number" value={item.gross_weight_kg || ""} onChange={e => updateItem(idx, "gross_weight_kg", parseFloat(e.target.value) || 0)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs text-green-600">Net kg/Carton</Label><Input type="number" value={item.net_weight_kg || ""} onChange={e => updateItem(idx, "net_weight_kg", parseFloat(e.target.value) || 0)} className="h-8 text-sm mt-1" /></div>
                      <div><Label className="text-xs text-green-600">CBM/Ctn</Label><Input type="number" step="0.0001" value={item.cbm || ""} onChange={e => updateItem(idx, "cbm", parseFloat(e.target.value) || 0)} className="h-8 text-sm mt-1" /></div>
                    </div>
                  </div>
                ))}
              </div>
              {items.length > 0 && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg grid grid-cols-5 gap-3 text-sm">
                  <div><span className="text-gray-500 text-xs">Total Cartons</span><div className="font-bold text-blue-700">{items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0), 0)}</div></div>
                  <div><span className="text-gray-500 text-xs">Total Units</span><div className="font-bold text-blue-700">{items.reduce((s, i) => s + (parseFloat(i.total_units) || 0), 0)}</div></div>
                  <div><span className="text-gray-500 text-xs">Total Gross (kg)</span><div className="font-bold text-blue-700">{parseFloat(items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.gross_weight_kg) || 0), 0).toFixed(2))}</div></div>
                  <div><span className="text-gray-500 text-xs">Total Net (kg)</span><div className="font-bold text-blue-700">{parseFloat(items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.net_weight_kg) || 0), 0).toFixed(2))}</div></div>
                  <div><span className="text-gray-500 text-xs">Total CBM</span><div className="font-bold text-blue-700">{parseFloat(items.reduce((s, i) => s + (parseFloat(i.num_cartons) || 0) * (parseFloat(i.cbm) || 0), 0).toFixed(4))}</div></div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-between">
              <Button variant="outline" onClick={() => navigate("/Dashboard")}>← Dashboard</Button>
              <div className="flex gap-2">
                <Button onClick={() => save.mutate(form)} disabled={save.isPending} variant="outline">
                  {save.isPending ? "Saving..." : "Save PO"}
                </Button>
                <Button onClick={async () => { try { await save.mutateAsync(form); setStep(2); } catch {} }} disabled={save.isPending} className="bg-blue-600 hover:bg-blue-700">
                  Save & Add Shipping Info →
                </Button>
              </div>
            </div>
          </>
        )}

        {/* STEP 2: Shipping */}
        {step === 2 && (
          <>
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-gray-800 mb-1">Shipping & Container Information</h2>
              <p className="text-xs text-gray-500 mb-4">Complete this when you're ready to ship. Required for SCLP generation.</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Load Type</Label>
                  <Select value={form.load_type} onValueChange={fv("load_type")}>
                    <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FCL">FCL – Full Container Load</SelectItem>
                      <SelectItem value="LCL">LCL – Less than Container</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Container Size</Label>
                  <Select value={form.container_size || "40HC"} onValueChange={fv("container_size")}>
                    <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20' Dry</SelectItem>
                      <SelectItem value="40">40' Dry</SelectItem>
                      <SelectItem value="40HC">40' HC (High Cube)</SelectItem>
                      <SelectItem value="45">45'</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Container Number</Label><Input value={form.container_number} onChange={f("container_number")} placeholder="e.g. GCNU4793137" className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Seal Number</Label><Input value={form.seal_number} onChange={f("seal_number")} placeholder="e.g. 7785261" className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Booking #</Label><Input value={form.apl_booking_number} onChange={f("apl_booking_number")} placeholder="e.g. 659969" className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Vessel Name</Label><Input value={form.vessel_name || ""} onChange={f("vessel_name")} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Voyage #</Label><Input value={form.voyage_number || ""} onChange={f("voyage_number")} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Port of Loading</Label><Input value={form.port_of_loading || ""} onChange={f("port_of_loading")} placeholder="e.g. Montreal" className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Actual Delivery Date to Port</Label><Input type="date" value={form.delivery_date || ""} onChange={f("delivery_date")} className="h-8 text-sm mt-1" /></div>
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Exporter Name <span className="text-gray-400 font-normal">(UK Origin Declaration signature)</span>
                  </Label>
                  <Input value={form.exporter_name || ""} onChange={f("exporter_name")} placeholder="e.g. Mendel Hart" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Exporter Title</Label>
                  <Input value={form.exporter_title || ""} onChange={f("exporter_title")} placeholder="e.g. Owner, President" className="h-8 text-sm mt-1" />
                </div>
              </div>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg grid grid-cols-4 gap-3 text-sm">
                <div><Label className="text-xs">Total Cartons</Label><Input type="number" value={form.total_cartons || ""} onChange={fn("total_cartons")} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Total Pallets</Label><Input type="number" value={form.total_pallets || ""} onChange={fn("total_pallets")} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Total Gross Wt (kg)</Label><Input type="number" value={form.total_gross_weight_kg || ""} onChange={fn("total_gross_weight_kg")} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Total CBM</Label><Input type="number" value={form.total_cbm || ""} onChange={fn("total_cbm")} className="h-8 text-sm mt-1" /></div>
              </div>
              <div className="mt-5">
                <h3 className="font-medium text-gray-700 mb-2 text-sm">Container 7-Point Security Inspection</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {["Front Wall","Right Side Wall","Left Side Wall","Inside/Outside Doors","Outside/Undercarriage","Ceiling/Roof","Floor"].map(point => (
                    <div key={point} className="flex items-center gap-2 bg-gray-50 border rounded px-3 py-2">
                      <span className="text-xs text-gray-600 flex-1">{point}</span>
                      <select value={(form.security_checks || {})[point] || "Yes"} onChange={e => setForm(p => ({ ...p, security_checks: { ...(p.security_checks || {}), [point]: e.target.value } }))} className="text-xs border rounded px-1 py-0.5">
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <Label className="text-xs">Notes</Label>
                <textarea value={form.notes || ""} onChange={f("notes")} className="w-full border rounded-md p-2 text-sm mt-1 h-16 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>← Back to PO Details</Button>
              <div className="flex gap-2">
                <Button onClick={() => save.mutate(form)} disabled={save.isPending} className={saved ? "bg-green-600 hover:bg-green-700" : ""}>
                  {save.isPending ? "Saving..." : saved ? "Saved ✓" : "Save"}
                </Button>
                <Button onClick={async () => { try { await save.mutateAsync(form); goToDocuments("SCLP"); } catch {} }} disabled={save.isPending} className="bg-red-600 hover:bg-red-700">
                  Save & Generate SCLP
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {savedId && (
        <EmailAplDialog
          open={showAplEmail}
          onClose={() => setShowAplEmail(false)}
          selectedPos={[{ ...form, id: savedId }]}
          vendors={vendorsSafe}
          onSent={({ bookingNumber, sentAt }) => {
            setForm(p => ({
              ...p,
              apl_booking_number: bookingNumber || p.apl_booking_number,
              apl_email_sent_at: sentAt,
              status: (bookingNumber || p.apl_booking_number) ? bumpStatus(p.status, "booked") : (p.status || "draft"),
            }));
            qc.invalidateQueries({ queryKey: ["pos"] });
          }}
        />
      )}
    </div>
  );
}