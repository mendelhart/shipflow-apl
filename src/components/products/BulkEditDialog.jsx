import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { friendlyErrorMessage } from "@/lib/errors";

const FIELDS = [
  { key: "country_of_origin", label: "Country of Origin", type: "text" },
  { key: "unit_price_cad", label: "Unit Price (CAD)", type: "number" },
  { key: "units_per_carton", label: "Units per Carton", type: "number" },
  { key: "carton_gross_weight_kg", label: "Gross Weight/Carton (kg)", type: "number" },
  { key: "carton_net_weight_kg", label: "Net Weight/Carton (kg)", type: "number" },
  { key: "carton_cbm", label: "Volume/Carton (CBM)", type: "number" },
  { key: "size", label: "Size", type: "text" },
  { key: "hs_code", label: "HS Code", type: "text" },
  { key: "shelf_life_days", label: "Shelf Life (days)", type: "number" },
  { key: "storage_instructions", label: "Storage Instructions", type: "text" },
];

export default function BulkEditDialog({ open, onClose, products, selectedIds, onSuccess }) {
  const [enabled, setEnabled] = useState({});
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);

  const targetIds = selectedIds && selectedIds.length > 0 ? selectedIds : products.map(p => p.id);

  const toggle = (key) => setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  const setVal = (key, val) => setValues(prev => ({ ...prev, [key]: val }));

  const handleApply = async () => {
    const updates = {};
    let badNumber = null;
    Object.keys(enabled).forEach(k => {
      if (enabled[k] && values[k] !== undefined && values[k] !== "") {
        if (FIELDS.find(f => f.key === k)?.type === "number") {
          const n = parseFloat(values[k]);
          // parseFloat("abc") is NaN, which serialises to null and would WIPE
          // the field on every selected product instead of setting it.
          if (!Number.isFinite(n)) { badNumber = k; return; }
          updates[k] = n;
        } else {
          updates[k] = values[k];
        }
      }
    });
    if (badNumber) {
      setError(`"${FIELDS.find(f => f.key === badNumber)?.label || badNumber}" is not a valid number.`);
      return;
    }
    if (Object.keys(updates).length === 0) {
      setError(
        Object.values(enabled).some(Boolean)
          ? "Enter a value for each field you have checked."
          : "Check at least one field to change."
      );
      return;
    }

    setSaving(true);
    setError("");
    setProgress({ done: 0, total: targetIds.length });

    // Previously: Promise.all over every id with no catch. One rejection threw
    // out of the handler, so `saving` was never cleared, the dialog hung, and —
    // worse — the user was never told WHICH products had been updated and which
    // had not. That is the "not all products get saved" symptom: the writes
    // genuinely were partial, and nothing said so.
    //
    // Now: bounded concurrency, every result collected, failures reported.
    const CONCURRENCY = 5;
    const failures = [];
    let done = 0;
    const queue = [...targetIds];

    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        try {
          await base44.entities.Product.update(id, updates);
        } catch (err) {
          const p = products.find(x => x.id === id);
          failures.push({ id, label: p?.item_number || p?.description || id, err });
        } finally {
          done += 1;
          setProgress({ done, total: targetIds.length });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetIds.length) }, worker));

    setSaving(false);
    setProgress(null);

    // onSuccess() used to run here, before the failure check. It clears the
    // selection, and targetIds falls back to EVERY product when the selection is
    // empty — so a dialog left open to show 2 failures silently retargeted its
    // own retry button at the whole catalog. Only tell the caller we succeeded
    // once we know we did.
    if (failures.length > 0) {
      setError(
        `${targetIds.length - failures.length} of ${targetIds.length} products updated. ` +
        `Failed: ${failures.slice(0, 5).map(f => f.label).join(", ")}` +
        `${failures.length > 5 ? ` and ${failures.length - 5} more` : ""}. ` +
        `${friendlyErrorMessage(failures[0].err, "")}`
      );
      return; // keep the dialog open so the failures are visible
    }
    onSuccess();
    // Not handleClose(): `saving` is still true in this closure (setSaving is
    // async), so handleClose's in-flight guard would swallow the reset and the
    // dialog would reopen pre-filled with the last edit.
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setEnabled({});
    setValues({});
    setError("");
  };

  const handleClose = () => {
    if (saving) return; // don't discard an in-flight bulk update
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Bulk Edit — {targetIds.length} product{targetIds.length !== 1 ? "s" : ""}
            {selectedIds && selectedIds.length > 0 ? " (selected)" : " (all)"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-500 mb-3">Check the fields you want to update. Only checked fields will be changed.</p>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {FIELDS.map(({ key, label, type }) => (
            <div key={key} className="flex items-center gap-3">
              <Checkbox
                checked={!!enabled[key]}
                onCheckedChange={() => toggle(key)}
                id={`bulk-${key}`}
              />
              <Label htmlFor={`bulk-${key}`} className="w-44 text-xs flex-shrink-0 cursor-pointer">{label}</Label>
              <Input
                type={type}
                disabled={!enabled[key]}
                value={values[key] ?? ""}
                onChange={e => setVal(key, e.target.value)}
                className="h-8 text-sm flex-1"
                placeholder={enabled[key] ? "Enter value..." : "—"}
              />
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleApply}
            disabled={saving || Object.values(enabled).every(v => !v)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saving
              ? `Applying… ${progress ? `${progress.done}/${progress.total}` : ""}`
              : `Apply to ${targetIds.length} product${targetIds.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}