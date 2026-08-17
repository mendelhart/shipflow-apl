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

export default function Labels() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);

  const [selectedPO, setSelectedPO] = useState(urlParams.get("po") || "");
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

  const handlePrint = () => window.print();

  const handleDownload = async () => {
    const { default: html2canvas } = await import("html2canvas");
    // FIX: jspdf exports jsPDF as a NAMED export, not a default export.
    // Destructuring `default` here gave `undefined`, so `new jsPDF(...)`
    // would throw "jsPDF is not a constructor" the first time this ran.
    // (CommercialInvoice.jsx already uses the correct form elsewhere.)
    const { jsPDF } = await import("jspdf");

    const container = document.getElementById("printable-labels");
    if (!container) return;

    const labels = Array.from(
      container.querySelectorAll("[data-label]")
    );

    const pdf = new jsPDF({
      unit: "pt",
      format: [288, 432], // 4x6 inches
      orientation: "portrait"
    });

    for (let i = 0; i < labels.length; i++) {
      const canvas = await html2canvas(labels[i], {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff"
      });

      const img = canvas.toDataURL("image/png");

      if (i > 0) pdf.addPage([288, 432], "portrait");

      pdf.addImage(img, "PNG", 0, 0, 288, 432);
    }

    pdf.save(`carton_labels_${po?.po_number || "export"}.pdf`);
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
          <Button size="sm" onClick={handleDownload} disabled={!po}>
            <Download className="w-4 h-4 mr-1" />PDF
          </Button>
          <Button size="sm" onClick={handlePrint} disabled={!po}>
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
          <div id="printable-labels">
            <CartonLabelSet
              po={po}
              vendor={vendor}
              startBox={startBox}
            />
          </div>
        )}
      </div>

      {/* PRINT CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }

          @page {
            size: 4in 6in;
            margin: 0;
          }

          html, body {
            margin: 0;
            padding: 0;
          }

          #printable-labels {
            margin: 0;
            padding: 0;
          }

          [data-label] {
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>
    </div>
  );
}

/* =========================
   LABEL SET (FIXED 4x6)
========================= */
function CartonLabelSet({ po, vendor, startBox }) {
  const items = po.items || [];
  const labels = [];

  items.forEach(item => {
    const cartons = parseInt(item.num_cartons) || 0;

    for (let i = 0; i < cartons; i++) {
      labels.push(
        <div
          key={`${item.item_number}-${i}`}
          data-label
          style={{
            width: "4in",
            height: "6in",
            overflow: "hidden",
            display: "block",
            pageBreakAfter: "always",
            breakAfter: "page",
            boxSizing: "border-box"
          }}
        >
          <div style={{ width: "100%", height: "100%" }}>
            <CartonLabel
              po={po}
              vendor={vendor}
              item={item}
              boxNumber={i + startBox}
              totalBoxes={cartons}
            />
          </div>
        </div>
      );
    }
  });

  return <div>{labels}</div>;
}