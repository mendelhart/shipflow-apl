import { useState } from "react";
import { isGeminiConfigured } from "@/lib/aiClient";
import { enrichENumbersForProduct, auditFdcData } from "@/lib/fdcAi";
import FdcAuditDialog from "@/components/shared/FdcAuditDialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, ShieldCheck, AlertCircle } from "lucide-react";

// AI actions for the Add/Edit Product form: (1) "Add E Numbers" enriches the
// form's ingredient rows in place (no save), and (2) "Audit with Gemini"
// checks all the entered product + ingredient info and reports missing data
// and mistakes. Both run through the shared Gemini client — no Base44 credits.
export default function ProductFormAi({ form, setForm }) {
  const [eBusy, setEBusy] = useState(false);
  const [eStatus, setEStatus] = useState("");
  const [eError, setEError] = useState("");

  const [auditBusy, setAuditBusy] = useState(false);
  const [auditStatus, setAuditStatus] = useState("");
  const [auditError, setAuditError] = useState("");
  const [auditResult, setAuditResult] = useState(null);

  const configured = isGeminiConfigured();
  const hasIngredients = (form.fdc_ingredients || []).length > 0;

  const handleAddENumbers = async () => {
    if (!hasIngredients) {
      setEError("Add at least one ingredient first.");
      return;
    }
    setEBusy(true);
    setEError("");
    setEStatus("Looking up E-numbers…");
    try {
      const { ingredients } = await enrichENumbersForProduct(form, (s) => setEStatus(s.message || s.phase));
      setForm((p) => ({ ...p, fdc_ingredients: ingredients }));
      setEStatus("Done — E-numbers filled into the ingredient table.");
      setTimeout(() => setEStatus(""), 4000);
    } catch (err) {
      setEError(err?.message || "Failed to look up E-numbers.");
      setEStatus("");
    } finally {
      setEBusy(false);
    }
  };

  const handleAudit = async () => {
    setAuditBusy(true);
    setAuditError("");
    setAuditResult(null);
    setAuditStatus("Building audit dataset…");
    try {
      const payload = [
        {
          product: form.description || form.item_number || "",
          item_number: form.item_number,
          upc: form.upc_code,
          hs_code: form.hs_code,
          size: form.size,
          country_of_origin: form.fdc_consolidated_coo || form.country_of_origin,
          shelf_life_days: form.shelf_life_days,
          storage_instructions: form.storage_instructions,
          product_of_animal_origin: form.fdc_product_of_animal_origin,
          ingredients: (form.fdc_ingredients || []).map((i) => ({
            name: i.name,
            pct_by_weight: i.pct_by_weight,
            country_of_origin: i.country_of_origin,
            animal_or_plant: i.animal_or_plant,
            approval_number: i.approval_number,
            heat_treatment: i.heat_treatment,
            heat_treatment_eggs: i.heat_treatment_eggs,
            e_number: i.e_number || "",
          })),
        },
      ];
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
    <div className="col-span-2 mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleAddENumbers}
          disabled={eBusy || auditBusy || !configured || !hasIngredients}
          className="border-violet-300 text-violet-700 hover:bg-violet-50 h-7"
        >
          {eBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
          Add E Numbers
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAudit}
          disabled={eBusy || auditBusy || !configured}
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-7"
        >
          {auditBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
          Audit with Gemini
        </Button>
        {!configured && <span className="text-xs text-amber-600">Gemini key needed — Settings</span>}
      </div>

      {eStatus && !eError && (
        <div className="flex items-center gap-1 mt-1 text-xs text-violet-600">
          <Loader2 className="w-3 h-3 animate-spin" />
          {eStatus}
        </div>
      )}
      {eError && (
        <div className="flex items-start gap-1 mt-1 text-xs text-red-600">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          {eError}
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
    </div>
  );
}