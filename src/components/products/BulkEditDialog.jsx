import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

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

  const targetIds = selectedIds && selectedIds.length > 0 ? selectedIds : products.map(p => p.id);

  const toggle = (key) => setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  const setVal = (key, val) => setValues(prev => ({ ...prev, [key]: val }));

  const handleApply = async () => {
    const updates = {};
    Object.keys(enabled).forEach(k => {
      if (enabled[k] && values[k] !== undefined && values[k] !== "") {
        updates[k] = FIELDS.find(f => f.key === k)?.type === "number" ? parseFloat(values[k]) : values[k];
      }
    });
    if (Object.keys(updates).length === 0) return;
    setSaving(true);
    await Promise.all(targetIds.map(id => base44.entities.Product.update(id, updates)));
    setSaving(false);
    onSuccess();
    onClose();
  };

  const handleClose = () => {
    setEnabled({});
    setValues({});
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
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleApply}
            disabled={saving || Object.values(enabled).every(v => !v)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saving ? "Applying..." : `Apply to ${targetIds.length} product${targetIds.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}