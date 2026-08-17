import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, Download, Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PalletSlotLabel from "@/components/documents/PalletSlotLabel";

export default function PalletLabels() {
  const navigate = useNavigate();

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => base44.entities.Product.list(),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["appSettings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });
  const appSettings = settings?.[0] || {};

  // selections: [{ productId, slots }]
  const [selections, setSelections] = useState([]);
  const [search, setSearch] = useState("");

  const addProduct = (productId) => {
    if (selections.find(s => s.productId === productId)) return;
    setSelections([...selections, { productId, slots: 1 }]);
  };

  const updateSlots = (productId, slots) => {
    setSelections(selections.map(s => s.productId === productId ? { ...s, slots: Math.max(1, parseInt(slots) || 1) } : s));
  };

  const removeProduct = (productId) => {
    setSelections(selections.filter(s => s.productId !== productId));
  };

  const filteredProducts = products.filter(p =>
    !search ||
    (p.description || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.item_number || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.upc_code || "").toLowerCase().includes(search.toLowerCase())
  );

  // Build flat list of labels
  const labels = [];
  selections.forEach(({ productId, slots }) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    for (let i = 0; i < slots; i++) {
      labels.push({ product, slotNumber: i + 1, totalSlots: slots });
    }
  });

  const handlePrint = () => window.print();

  const handleDownload = async () => {
    const { default: html2canvas } = await import("html2canvas");
    const { default: jsPDF } = await import("jspdf");

    const container = document.getElementById("printable-pallet-labels");
    if (!container) return;

    const labelEls = Array.from(container.querySelectorAll("[data-label]"));
    if (!labelEls.length) return;

    const pdf = new jsPDF({ unit: "pt", format: [432, 288], orientation: "landscape" });

    for (let i = 0; i < labelEls.length; i++) {
      const canvas = await html2canvas(labelEls[i], { scale: 3, useCORS: true, backgroundColor: "#ffffff" });
      const img = canvas.toDataURL("image/png");
      if (i > 0) pdf.addPage([432, 288], "landscape");
      pdf.addImage(img, "PNG", 0, 0, 432, 288);
    }

    pdf.save(`pallet_slot_labels_${labels.length}_total.pdf`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* HEADER */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex-1">Pallet Slot Labels (4×6)</h1>
        <Button size="sm" onClick={handleDownload} disabled={!labels.length}>
          <Download className="w-4 h-4 mr-1" />PDF
        </Button>
        <Button size="sm" onClick={handlePrint} disabled={!labels.length}>
          <Printer className="w-4 h-4 mr-1" />Print
        </Button>
      </div>

      <div className="flex gap-6 p-6 max-w-7xl mx-auto">
        {/* LEFT: Product picker + selections */}
        <div className="w-96 space-y-4 no-print">
          {/* Search & product list */}
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filteredProducts.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-4">No products found</div>
              )}
              {filteredProducts.map(p => {
                const selected = selections.find(s => s.productId === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p.id)}
                    disabled={!!selected}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                      selected
                        ? "bg-green-50 border-green-200 text-green-700 cursor-default"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="font-medium truncate">{p.description}</div>
                    <div className="text-xs text-gray-500">{p.item_number} {p.size ? `· ${p.size}` : ""}</div>
                    {selected && <div className="text-xs text-green-600 font-medium mt-0.5">✓ Added</div>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected products with slot counts */}
          <div className="bg-white rounded-xl border p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">Selected Products</div>
            {selections.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-4">Pick products above to generate labels</div>
            ) : (
              <div className="space-y-2">
                {selections.map(s => {
                  const p = products.find(pr => pr.id === s.productId);
                  if (!p) return null;
                  return (
                    <div key={s.productId} className="flex items-center gap-2 border rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.description}</div>
                        <div className="text-xs text-gray-500">{p.item_number}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs whitespace-nowrap">Slots</Label>
                        <Input
                          type="number"
                          value={s.slots}
                          onChange={e => updateSlots(s.productId, e.target.value)}
                          className="h-8 w-14"
                          min={1}
                        />
                      </div>
                      <button
                        onClick={() => removeProduct(s.productId)}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {selections.length > 0 && (
              <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                <span className="text-gray-500">Total labels:</span>
                <span className="font-bold text-gray-800">{labels.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Label preview */}
        <div className="flex-1 min-w-0">
          {!labels.length ? (
            <div className="text-center text-gray-400 py-12">
              <Plus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Select products and set slot counts to preview labels
            </div>
          ) : (
            <div id="printable-pallet-labels" className="space-y-4">
              {labels.map((lbl, i) => (
                <div
                  key={i}
                  data-label
                  style={{
                    width: "6in",
                    height: "4in",
                    overflow: "hidden",
                    display: "block",
                    pageBreakAfter: "always",
                    breakAfter: "page",
                    boxSizing: "border-box",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                  }}
                >
                  <PalletSlotLabel
                    product={lbl.product}
                    appSettings={appSettings}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PRINT CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page {
            size: 6in 4in;
            margin: 0;
          }
          html, body { margin: 0; padding: 0; }
          #printable-pallet-labels {
            margin: 0;
            padding: 0;
          }
          [data-label] {
            page-break-after: always;
            break-after: page;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}