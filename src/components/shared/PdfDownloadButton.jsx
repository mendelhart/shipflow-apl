import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export default function PdfDownloadButton({ contentId, title }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    const el = document.getElementById(contentId);
    if (!el) return;
    setLoading(true);

    const pdf = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
    const pageW = 8.5;
    const pageH = 11;
    const margin = 0.4;
    const contentW = pageW - margin * 2;
    const contentH = pageH - margin * 2;

    // Find page-break children (each FDC form has pageBreakAfter)
    // Try to split on direct children with pageBreakAfter style
    const children = Array.from(el.querySelectorAll('[style*="pageBreakAfter"], [style*="page-break-after"]'));
    const sections = children.length > 0 ? children : [el];

    let firstPage = true;
    for (const section of sections) {
      const canvas = await html2canvas(section, {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        imageTimeout: 0,
      });

      const imgData = canvas.toDataURL("image/png");
      const imgW = canvas.width / 2;
      const imgH = canvas.height / 2;
      const pxPerInch = 96;
      const docWIn = imgW / pxPerInch;
      const docHIn = imgH / pxPerInch;

      const scaleToFit = Math.min(contentW / docWIn, contentH / docHIn, 1);
      const finalW = docWIn * scaleToFit;
      const finalH = docHIn * scaleToFit;
      const x = margin + (contentW - finalW) / 2;
      const y = margin;

      if (!firstPage) pdf.addPage();
      pdf.addImage(imgData, "PNG", x, y, finalW, finalH);
      firstPage = false;
    }

    pdf.save(`${title.replace(/\s+/g, "_")}.pdf`);
    setLoading(false);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading}>
      <Download className="w-4 h-4 mr-1" />
      {loading ? "Generating..." : "Download PDF"}
    </Button>
  );
}