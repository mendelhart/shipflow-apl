import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PrintWrapper from "@/components/shared/PrintWrapper";
import VectorPdfButton from "@/components/shared/VectorPdfButton";
import { formatPoNumber } from "@/utils/poNumber";
import FoodChecklistDoc, { RepeatVendorApprovalDoc } from "@/components/documents/FoodChecklistDoc";
import { buildFdcPdf, buildRepeatFdcPdf } from "@/lib/emailDocs";
import POGroupedSelector from "@/components/shared/POGroupedSelector";
import FdcAiPanel from "@/components/foodchecklist/FdcAiPanel";

// Repeat Vendor Approval is always approving Capital Nutrition itself as the
// repeat shipper — it is NOT a lookup of the PO's own vendor_id (that field
// refers to Capital Nutrition's supplier for that PO, a different party).
// If RepeatVendorApprovalDoc reads more fields off `vendor` than
// company_name/address, add them here.
const CAPITAL_NUTRITION_VENDOR = {
  company_name: "Capital Nutrition Inc.",
  address: "1020 Boul. Michèle-Bohec, Blainville, QC J7C 5E2, Canada",
};

export default function FoodChecklist() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const initPO = urlParams.get("po") || "";
  const initMode = urlParams.get("mode") === "repeat" ? "repeat" : "fdc";

  const [selectedIds, setSelectedIds] = useState(initPO ? [initPO] : []);
  const [docMode, setDocMode] = useState(initMode);

  const { data: pos = [] } = useQuery({ queryKey: ["pos"], queryFn: () => base44.entities.PurchaseOrder.list("-created_date") });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });

  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleGroup = (ids, allSelected) => setSelectedIds(prev =>
    allSelected ? prev.filter(x => !ids.includes(x)) : [...new Set([...prev, ...ids])]
  );

  const selectedPOs = pos.filter(p => selectedIds.includes(p.id));
  const getVendor = (po) => vendors.find(v => v.id === po.vendor_id);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Food Detail Checklist</h1>
        <div className="text-xs text-gray-500 mr-2 hidden md:block">Required for Dept 81 (Food) shipments</div>

        {/* Doc mode toggle */}
        <div className="flex gap-2">
          <Button size="sm" variant={docMode === "fdc" ? "default" : "outline"} onClick={() => setDocMode("fdc")}>
            FDC (per item)
          </Button>
          <Button
            size="sm"
            variant={docMode === "repeat" ? "default" : "outline"}
            onClick={() => setDocMode("repeat")}
            className={docMode === "repeat" ? "bg-amber-600 hover:bg-amber-700" : ""}
          >
            Repeat Vendor Approval
          </Button>
        </div>

        {selectedIds.length > 0 && (
          <Button size="sm" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
            <Printer className="w-4 h-4 mr-1" />
            Print All ({selectedIds.length})
          </Button>
        )}
        {docMode === "fdc" && selectedIds.length > 0 && (
          <FdcAiPanel selectedPOs={selectedPOs} products={products} vendors={vendors} />
        )}
      </div>

      {/* PO multi-selector */}
      <div className="bg-white border-b px-6 py-3 no-print">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">Select POs</span>
          <span className="text-xs text-gray-400">{selectedIds.length} selected</span>
        </div>
        <POGroupedSelector
          pos={pos}
          selectedIds={selectedIds}
          onToggle={toggleOne}
          onToggleGroup={toggleGroup}
          mode="multi"
        />
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-8">
        {selectedPOs.length === 0 && (
          <div className="text-center py-12 text-gray-400">Select one or more POs above to generate the Food Detail Checklist.</div>
        )}
        {selectedPOs.map(po => {
          // FDC mode needs the PO's actual supplier vendor — block if missing,
          // same as before. Repeat mode is always approving Capital Nutrition
          // itself, so it never depends on po.vendor_id at all.
          const vendor = docMode === "fdc" && po.vendor_id ? getVendor(po) : null;
          if (!vendor && docMode === "fdc") return (
            <div key={po.id} className="text-center py-4 text-amber-600 bg-amber-50 rounded-lg border border-amber-200">
              Vendor not found for PO {formatPoNumber(po)}.
            </div>
          );
          const safeVendor = docMode === "repeat" ? CAPITAL_NUTRITION_VENDOR : vendor;
          const safeTitle = `${docMode === "repeat" ? "RepeatFDC" : "FDC"}_${po.po_prefix}_${po.po_number}`.replace(/\s+/g, "_");
          return (
            <PrintWrapper
              key={po.id}
              title={safeTitle}
              contentId={`fdc-${po.id}`}
              extraActions={
                <VectorPdfButton
                  buildFn={() => docMode === "fdc"
                    ? buildFdcPdf({ po, vendor: safeVendor, products })
                    : buildRepeatFdcPdf({ po, vendor: safeVendor })}
                  filename={`${safeTitle}.pdf`}
                />
              }
            >
              {docMode === "fdc"
                ? <FoodChecklistDoc po={po} vendor={safeVendor} products={products} />
                : <RepeatVendorApprovalDoc po={po} vendor={safeVendor} />
              }
            </PrintWrapper>
          );
        })}
      </div>

      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}
