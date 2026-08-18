import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";


export default function PdfDownloadButton({ contentId, title }) {
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState(null);

  const handleDownload = async () => {
    const el = document.getElementById(contentId);
    if (!el) return;
    setLoading(true);
    setError(null);

    try {
    // Loaded on demand: keeps the 1.1 MB PDF chunk out of every route that
    // merely renders a PrintWrapper.
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import("jspdf"),
      import("html2canvas"),
    ]);

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
    } catch (err) {
      // Without this the button stayed disabled on "Generating…" forever —
      // html2canvas throws on a tainted canvas (a cross-origin logo) or an
      // oversized render, and setLoading(false) was never reached.
      console.error("PDF generation failed:", err);
      setError(err?.message || "Could not generate the PDF.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading}>
      <Download className="w-4 h-4 mr-1" />
      {loading ? "Generating..." : "Download PDF"}
    </Button>
    {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}