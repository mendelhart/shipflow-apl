import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PrintWrapper from "@/components/shared/PrintWrapper";
import VectorPdfButton from "@/components/shared/VectorPdfButton";
import PackingListDoc from "@/components/documents/PackingListDoc";
import { buildPackingListPdf } from "@/lib/emailDocs";
import POGroupedSelector from "@/components/shared/POGroupedSelector";

export default function PackingLists() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const initPO = urlParams.get("po") || "";
  const [selectedIds, setSelectedIds] = useState(initPO ? [initPO] : []);

  const { data: pos = [] } = useQuery({ queryKey: ["pos"], queryFn: () => base44.entities.PurchaseOrder.list("-created_date") });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });

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
        <h1 className="text-xl font-bold text-gray-900 flex-1">Packing List</h1>
        {selectedIds.length > 0 && (
          <Button size="sm" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
            <Printer className="w-4 h-4 mr-1" />
            Print {selectedIds.length} Packing List{selectedIds.length > 1 ? "s" : ""}
          </Button>
        )}
      </div>

      {/* PO selector — grouped by date */}
      <div className="bg-white border-b px-6 py-3 no-print">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600">Select POs</span>
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
          <div className="text-center py-12 text-gray-400">Select one or more POs above to generate packing lists.</div>
        )}
        {selectedPOs.map(po => {
          const vendor = getVendor(po);
          if (!vendor) return (
            <div key={po.id} className="text-center py-4 text-amber-600 bg-amber-50 rounded-lg">
              Vendor not found for PO {po.po_number}.
            </div>
          );
          return (
            <PrintWrapper
              key={po.id}
              title={`Packing_List_${po.po_prefix}_${po.po_number}`}
              contentId={`pl-${po.id}`}
              extraActions={
                <VectorPdfButton
                  buildFn={() => buildPackingListPdf({ po, vendor })}
                  filename={`Packing_List_${po.po_prefix}_${po.po_number}.pdf`}
                />
              }
            >
              <PackingListDoc po={po} vendor={vendor} />
            </PrintWrapper>
          );
        })}
      </div>

      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}
