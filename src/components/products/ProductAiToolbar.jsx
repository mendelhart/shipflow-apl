import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { isGeminiConfigured } from "@/lib/aiClient";
import { enrichENumbersForProduct } from "@/lib/fdcAi";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, AlertCircle } from "lucide-react";

// Bulk "Add E Numbers" action for the Products catalog table. Enriches the
// selected products (or every food product with ingredients, if none are
// selected) via Gemini and persists each one. No Base44 credits used.
export default function ProductAiToolbar({ products, selectedIds = [], onDone }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const configured = isGeminiConfigured();

  const targets = selectedIds.length
    ? products.filter((p) => selectedIds.includes(p.id))
    : products.filter((p) => p.is_food);
  const withIngs = targets.filter((p) => (p.fdc_ingredients || []).length > 0);

  const handleAddENumbers = async () => {
    if (withIngs.length === 0) {
      setError("No food products with FDC ingredients found. Select products or add ingredients first.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus(`Looking up E-numbers for ${withIngs.length} product(s)…`);
    let updated = 0;
    const failed = [];
    try {
      // Each product is handled independently. Previously one failure — a
      // rate limit, one malformed ingredient list — threw out of the loop and
      // every remaining product was silently left unenriched, with the count
      // of what HAD been saved discarded along with it.
      for (const prod of withIngs) {
        const label = prod.description || prod.item_number || prod.id;
        try {
          const { ingredients } = await enrichENumbersForProduct(prod, (s) =>
            setStatus(`Looking up E-numbers — "${label}" (${s.message || s.phase})`)
          );
          await base44.entities.Product.update(prod.id, { fdc_ingredients: ingredients });
          updated++;
        } catch (err) {
          console.error("E-number lookup failed for", label, err);
          failed.push(label);
        }
      }
      onDone?.();
      if (failed.length > 0) {
        setError(
          `Enriched ${updated} of ${withIngs.length}. Failed: ${failed.slice(0, 5).join(", ")}` +
          `${failed.length > 5 ? ` and ${failed.length - 5} more` : ""}.`
        );
        setStatus("");
      } else {
        setStatus(`Done — enriched ${updated} product(s).`);
        setTimeout(() => setStatus(""), 5000);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {!configured && (
        <span className="text-xs text-amber-600 whitespace-nowrap">Set Gemini key in Settings →</span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleAddENumbers}
        disabled={busy}
        className="border-violet-300 text-violet-700 hover:bg-violet-50"
      >
        {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
        {busy ? "Adding E#…" : "Add E Numbers"}
      </Button>
      {(status || error) && (
        <span className={`text-xs flex items-center gap-1 ${error ? "text-red-600" : "text-violet-600"}`}>
          {error ? <AlertCircle className="w-3 h-3" /> : null}
          {error || status}
        </span>
      )}
    </div>
  );
}