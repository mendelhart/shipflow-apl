import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CartonLabel from "@/components/documents/CartonLabel";
import { formatPoNumber } from "@/utils/poNumber";
import POGroupedSelector from "@/components/shared/POGroupedSelector";
import { labelPlan } from "@/domain/labelContent";
import { openPalletLabelsWindow } from "@/utils/palletLabels";

export default function Labels() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);

  const [selectedPO, setSelectedPO] = useState(urlParams.get("po") || "");

  const [pdfProgress, setPdfProgress] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [startBox, setStartBox] = useState(1);

  const { data: pos = [] } = useQuery({
    queryKey: ["pos"],
    queryFn: () =>
      base44.entities.PurchaseOrder.list("-created_date")
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => base44.entities.Vendor.list()
  });

  const po = pos.find(p => p.id === selectedPO);
  const vendor = po
    ? vendors.find(v => v.id === po.vendor_id)
    : null;

  const { plan: labelPlanItems, total: totalCartons } = labelPlan(po || {}, startBox);
  const palletCount = parseInt(po?.total_pallets) || 0;

  // Both buttons build the SAME document. Previously "Print" used the DOM and
  // "PDF" rasterised that DOM, so the two paths could diverge; now there is one
  // renderer and the preview below is explicitly a sample.
  const buildLabels = async () => {
    const { buildCartonLabelsPdf } = await import("@/lib/cartonLabelPdf");
    setPdfError(null);
    setPdfProgress({ done: 0, total: totalCartons });
    try {
      const { doc } = await buildCartonLabelsPdf({
        po,
        startBox,
        onProgress: (done, total) => setPdfProgress({ done, total }),
      });
      return doc;
    } finally {
      setPdfProgress(null);
    }
  };

  const handleDownload = async () => {
    try {
      const doc = await buildLabels();
      doc.save(`carton_labels_${po?.po_number || "export"}.pdf`);
    } catch (err) {
      console.error("Carton label PDF failed:", err);
      setPdfError(err?.message || "Could not generate the labels.");
    }
  };

  const handlePrint = async () => {
    try {
      const doc = await buildLabels();
      // Hand the browser the real document rather than printing the preview:
      // the preview is a sample, and printing it would produce one label per
      // item instead of one per carton.
      doc.autoPrint();
      const url = doc.output("bloburl");
      const win = window.open(url, "_blank");
      if (!win) {
        setPdfError(
          "Your browser blocked the print window. Allow pop-ups for this site, or use Download PDF."
        );
      }
    } catch (err) {
      console.error("Carton label print failed:", err);
      setPdfError(err?.message || "Could not prepare the labels for printing.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* HEADER */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {selectedPO && (
          <Link
            to={`/PurchaseOrders?id=${selectedPO}`}
            className="text-xs text-blue-600"
          >
            ← Back to PO
          </Link>
        )}

        <h1 className="text-xl font-bold flex-1">
          Carton Labels (4x6)
        </h1>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Label className="text-xs">Start box</Label>
            <Input
              type="number"
              value={startBox}
              onChange={e => setStartBox(parseInt(e.target.value) || 1)}
              className="h-8 w-16"
            />
          </div>
          <Button size="sm" onClick={handleDownload} disabled={!po || !!pdfProgress}>
            <Download className="w-4 h-4 mr-1" />
            {pdfProgress
              ? `${pdfProgress.done}/${pdfProgress.total}`
              : "PDF"}
          </Button>
          <Button size="sm" onClick={handlePrint} disabled={!po || !!pdfProgress}>
            <Printer className="w-4 h-4 mr-1" />Print
          </Button>
        </div>
      </div>

      {/* PO selector — grouped by date */}
      <div className="bg-white border-b px-6 py-3 no-print">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600">Select PO</span>
          {po && <span className="text-xs text-blue-600 font-medium">{formatPoNumber(po)}</span>}
        </div>
        <POGroupedSelector
          pos={pos}
          selectedIds={selectedPO ? [selectedPO] : []}
          onToggle={(id) => setSelectedPO(prev => prev === id ? "" : id)}
          mode="single"
        />
      </div>

      {/* CONTENT */}
      <div className="p-6 max-w-5xl mx-auto">
        {!po && (
          <div className="text-center text-gray-400 py-8">
            Select a PO above to generate labels.
          </div>
        )}

        {po && vendor && (
          <>
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm text-slate-700">
                <span className="font-medium">
                  {totalCartons.toLocaleString()} label{totalCartons === 1 ? "" : "s"}
                </span>{" "}
                will be produced — one per carton, numbered {startBox} to {startBox - 1 + totalCartons}
                {" "}across the whole PO.
              </div>
              <div className="text-xs text-slate-500">
                Preview shows one sample per item
              </div>
            </div>

            {/* Pallet labels are made right after the cartons are stickered and
                before a container is assigned, so they belong next to the carton
                labels rather than only on the container-planning screen. */}
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3">
              <div className="text-sm text-slate-700">
                <span className="font-medium">Pallet labels</span>
                {palletCount > 0
                  ? ` — ${palletCount} for this PO, numbered 1 to ${palletCount}.`
                  : " — set this PO's pallet count first (Purchase Orders → edit → Total Pallets)."}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={palletCount === 0}
                onClick={() =>
                  openPalletLabelsWindow({
                    selectedPOObjects: [po],
                    vendors,
                    getPalletCount: (p) => parseInt(p.total_pallets) || 0,
                  })
                }
              >
                <Printer className="w-4 h-4 mr-2" />
                Pallet labels
              </Button>
            </div>

            {pdfError && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {pdfError}
              </div>
            )}

            <div id="printable-labels">
              {labelPlanItems.map(({ item, cartons }) => (
                <div key={item.item_number} className="mb-6">
                  <div className="mb-1 text-xs font-medium text-slate-500">
                    {item.item_number} — {item.description} · {cartons} carton
                    {cartons === 1 ? "" : "s"}
                  </div>
                  <div
                    data-label
                    style={{
                      width: "4in",
                      height: "6in",
                      overflow: "hidden",
                      display: "block",
                      boxSizing: "border-box",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <CartonLabel
                      po={po}
                      vendor={vendor}
                      item={item}
                      boxNumber={startBox}
                      totalBoxes={cartons}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Printing goes through the generated PDF (see handlePrint), not the
          browser's print view of this page — the page only shows samples. */}
    </div>
  );
}
