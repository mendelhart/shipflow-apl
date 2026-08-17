import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardPaste } from "lucide-react";

/**
 * Parses a tab/newline table pasted from Excel or a document.
 * Expects columns: Ingredient | % by Weight | Country of Origin
 * Skips header rows (non-numeric / contains "ingredient" keyword).
 */
function parsePaste(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const results = [];

  for (const line of lines) {
    const cols = line.split(/\t/).map(c => c.trim());
    if (cols.length < 2) continue;

    const name = cols[0];
    const pct = cols[1];
    const coo = cols[2] || "";

    // Skip header rows
    if (!name || /^list of ingredient|^ingredient/i.test(name)) continue;
    if (/^ingredient|^%|^country/i.test(name)) continue;

    results.push({
      name,
      pct_by_weight: pct,
      country_of_origin: coo,
      animal_or_plant: "PLANT/VEGETABLE MATERIAL",
      approval_number: "",
      heat_treatment: "",
      heat_treatment_eggs: ""
    });
  }

  return results;
}

export default function FdcPasteDialog({ open, onClose, onApply }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);

  const handleParse = () => {
    const parsed = parsePaste(text);
    setPreview(parsed);
  };

  const handleApply = () => {
    if (!preview) return;
    onApply(preview);
    setText("");
    setPreview(null);
    onClose();
  };

  const handleClose = () => {
    setText("");
    setPreview(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5 text-blue-600" />
            Paste FDC Ingredients
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-gray-500 mb-2">
          Copy the ingredient table from Excel or Word (3 columns: Ingredient, % by Weight, Country of Origin) and paste it below.
        </p>

        <Textarea
          className="font-mono text-xs h-40 mb-3"
          placeholder={"Water\t98.00%\tUSA\nCellulose gum\t1.00%\tUSA\nSucralose\t<0.13%\tChina"}
          value={text}
          onChange={e => { setText(e.target.value); setPreview(null); }}
        />

        <div className="flex gap-2 mb-4">
          <Button variant="outline" onClick={handleParse} disabled={!text.trim()}>
            Preview Parsed Ingredients
          </Button>
        </div>

        {preview && (
          <>
            <div className="border rounded-lg overflow-hidden mb-4">
              <table className="w-full text-xs">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left">Ingredient</th>
                    <th className="px-3 py-2 text-left">% by Weight</th>
                    <th className="px-3 py-2 text-left">Country of Origin</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-4 text-gray-400">No ingredients parsed. Check your paste format.</td></tr>
                  )}
                  {preview.map((ing, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5">{ing.name}</td>
                      <td className="px-3 py-1.5">{ing.pct_by_weight}</td>
                      <td className="px-3 py-1.5">{ing.country_of_origin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                disabled={preview.length === 0}
                onClick={handleApply}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Apply {preview.length} Ingredient{preview.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </>
        )}

        {!preview && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}