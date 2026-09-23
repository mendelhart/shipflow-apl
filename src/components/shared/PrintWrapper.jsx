import { Printer, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import PdfDownloadButton from "@/components/shared/PdfDownloadButton";

// contentId can be passed explicitly (for multi-doc pages); defaults to unique slug from title.
// extraActions renders additional buttons alongside Print/Open in New Window — used to swap in
// a VectorPdfButton (real vector PDF, no screenshot quality ceiling) instead of showPdf's
// html2canvas-based PdfDownloadButton, for document types that have a vector builder available.
export default function PrintWrapper({ children, title, showPdf = false, contentId, extraActions }) {
  const id = contentId || ("pw-" + title.replace(/[^a-zA-Z0-9]/g, "_"));

  const getHtml = () => {
    const content = document.getElementById(id)?.innerHTML;
    return `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;font-size:10px;margin:10px;}table{width:100%;border-collapse:collapse;}td,th{border:1px solid #000;padding:3px 5px;font-size:10px;}@media print{button{display:none;}}</style></head><body>${content}</body></html>`;
  };

  const handleNewWindow = () => {
    const win = window.open("", "_blank");
    win.document.write(getHtml());
    win.document.close();
  };

  return (
    <div>
      <div className="flex gap-2 mb-4 no-print items-center flex-wrap">
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        <Button variant="outline" size="sm" onClick={handleNewWindow}><ExternalLink className="w-4 h-4 mr-1" />Open in New Window</Button>
        {showPdf && <PdfDownloadButton contentId={id} title={title} />}
        {extraActions}
      </div>
      <div id={id}>
        {children}
      </div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}
