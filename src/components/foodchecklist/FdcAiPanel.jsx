import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { isGeminiConfigured } from "@/lib/aiClient";
import { enrichENumbersForProduct, auditFdcData } from "@/lib/fdcAi";
import { Button } from "@/components/ui/button";
import FdcAuditDialog from "@/components/shared/FdcAuditDialog";
import { Loader2, Sparkles, ShieldCheck, AlertCircle } from "lucide-react";
import { formatPoNumber } from "@/utils/poNumber";

function getProductForItem(item, products) {
  return products.find(
    (p) =>
      p.id === item.product_id ||
      (item.item_number && p.item_number === item.item_number) ||
      (item.vendor_style && p.vendor_style === item.vendor_style) ||
      (item.vendor_style && p.item_number === item.vendor_style)
  );
}

function collectProducts(selectedPOs, products) {
  const seen = new Set();
  const result = [];
  for (const po of selectedPOs) {
    for (const item of po.items || []) {
      const prod = getProductForItem(item, products);
      if (prod && !seen.has(prod.id)) {
        seen.add(prod.id);
        result.push(prod);
      }
    }
  }
  return result;
}

// Gemini-powered actions for the Food Detail Checklist page: (1) enrich
// every selected PO's products with EU E-numbers (persisted to the Product),
// and (2) audit the full FDC dataset for missing info and mistakes. Uses the
// shared Gemini client — no Base44 AI credits are consumed.
export default function FdcAiPanel({ selectedPOs, products, vendors = [] }) {
  const qc = useQueryClient();
  const [eBusy, setEBusy] = useState(false);
  const [eStatus, setEStatus] = useState("");
  const [eError, setEError] = useState("");

  const [auditBusy, setAuditBusy] = useState(false);
  const [auditStatus, setAuditStatus] = useState("");
  const [auditError, setAuditError] = useState("");
  const [auditResult, setAuditResult] = useState(null);

  const configured = isGeminiConfigured();

  const handleAddENumbers = async () => {
    const prods = collectProducts(selectedPOs, products);
    const withIngs = prods.filter((p) => (p.fdc_ingredients || []).length > 0);
    if (withIngs.length === 0) {
      setEError("No products with FDC ingredients were found in the selected POs.");
      return;
    }

    setEBusy(true);
    setEError("");
    setEStatus(`Looking up E-numbers for ${withIngs.length} product(s)…`);

    let updated = 0;
    try {
      for (const prod of withIngs) {
        const label = prod.description || prod.item_number || prod.id;
        const { ingredients } = await enrichENumbersForProduct(prod, (s) =>
          setEStatus(`Looking up E-numbers — "${label}" (${s.message || s.phase})`)
        );
        await base44.entities.Product.update(prod.id, { fdc_ingredients: ingredients });
        updated++;
      }
      await qc.invalidateQueries({ queryKey: ["products"] });
      setEStatus(`Done — enriched ${updated} product(s). The FDC tables now show E-numbers.`);
      setTimeout(() => setEStatus(""), 5000);
    } catch (err) {
      setEError(err?.message || "Failed to look up E-numbers with Gemini.");
      setEStatus("");
    } finally {
      setEBusy(false);
    }
  };

  const handleAudit = async () => {
    const prods = collectProducts(selectedPOs, products);
    if (prods.length === 0) {
      setAuditError("No products with FDC data were found in the selected POs.");
      return;
    }

    setAuditBusy(true);
    setAuditError("");
    setAuditResult(null);
    setAuditStatus("Building audit dataset…");

    try {
      const payload = selectedPOs.flatMap((po) => {
        const vendor = vendors.find((v) => v.id === po.vendor_id);
        return (po.items || []).map((item) => {
          const prod = getProductForItem(item, products);
          return {
            po: formatPoNumber(po),
            product: item.description || prod?.description || "",
            destination: po.po_prefix === "55" ? "Germany" : "United Kingdom",
            vendor: vendor?.company_name || "",
            vendor_style: item.vendor_style || item.item_number || "",
            upc: item.upc_code || prod?.upc_code || "",
            hs_code: item.hs_code || prod?.hs_code || "",
            size: item.size || prod?.size || "",
            country_of_origin: prod?.fdc_consolidated_coo || item.country_of_origin || "",
            shelf_life_days: prod?.shelf_life_days || "",
            storage_instructions: prod?.storage_instructions || "",
            product_of_animal_origin: prod?.fdc_product_of_animal_origin || "",
            ingredients: (prod?.fdc_ingredients || []).map((i) => ({
              name: i.name,
              pct_by_weight: i.pct_by_weight,
              country_of_origin: i.country_of_origin,
              animal_or_plant: i.animal_or_plant,
              approval_number: i.approval_number,
              heat_treatment: i.heat_treatment,
              heat_treatment_eggs: i.heat_treatment_eggs,
              e_number: i.e_number || "",
            })),
          };
        });
      });

      const res = await auditFdcData(payload, (s) => setAuditStatus(s.message || s.phase));
      setAuditResult(res || { summary: "No response from Gemini.", issues: [] });
      setAuditStatus("");
    } catch (err) {
      setAuditError(err?.message || "Audit failed.");
      setAuditStatus("");
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 no-print">
        {!configured && (
          <span className="text-xs text-amber-600 hidden lg:inline">Gemini API key needed — Settings → Gemini API</span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleAddENumbers}
          disabled={eBusy || auditBusy || !configured}
          className="border-violet-300 text-violet-700 hover:bg-violet-50"
        >
          {eBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
          {eBusy ? "Adding E#…" : "Add E Numbers"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAudit}
          disabled={eBusy || auditBusy || !configured}
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        >
          {auditBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
          {auditBusy ? "Auditing…" : "Audit with Gemini"}
        </Button>
      </div>

      {(eStatus || eError) && (
        <div
          className={`mx-6 mt-2 flex items-start gap-2 rounded-lg border p-3 text-xs no-print ${
            eError ? "bg-red-50 border-red-200 text-red-700" : "bg-violet-50 border-violet-200 text-violet-700"
          }`}
        >
          {eError ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <Loader2 className="w-4 h-4 flex-shrink-0 mt-0.5 animate-spin" />}
          <span className="flex-1">{eError || eStatus}</span>
        </div>
      )}

      {auditError && !auditResult && (
        <div className="mx-6 mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 no-print">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{auditError}</span>
        </div>
      )}

      <FdcAuditDialog
        open={!!auditResult || auditBusy}
        result={auditResult}
        busy={auditBusy}
        busyStatus={auditStatus}
        error={auditError}
        onClose={() => {
          setAuditResult(null);
          setAuditError("");
        }}
      />
    </>
  );
}