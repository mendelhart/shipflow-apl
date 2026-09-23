import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// Downloads a real vector PDF built by `buildFn` (any of the builders in
// @/lib/emailDocs — buildCommercialInvoicePdf, buildPackingListPdf,
// buildFdcPdf, buildRepeatFdcPdf, etc.) rather than screenshotting the
// on-screen DOM like the older PdfDownloadButton did. No html2canvas, no
// raster-image quality ceiling — the downloaded file is exactly as sharp
// as what Print produces, because it's built the same way: real text and
// vector drawing instructions, not a picture of the page.
export default function VectorPdfButton({ buildFn, filename, label = "Download PDF" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const bytes = await buildFn();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
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
        {loading ? "Generating..." : label}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
