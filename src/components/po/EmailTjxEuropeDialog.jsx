import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, FileText, CheckCircle, Pencil, Mail, Download, AlertCircle } from "lucide-react";
import { formatPoNumber } from "@/utils/poNumber";
import {
  buildCommercialInvoicePdf,
  buildPackingListPdf,
  uint8ToBase64,
  buildEmailBatches,
  downloadBatchEml,
  downloadBatchZipAndOpenMailDraft,
  friendlyErrorMessage,
  bumpStatus,
} from "@/lib/emailDocs";

// TJX Europe billing flow — generates the same real vector-PDF commercial
// invoices (and optional packing lists) as the APL Logistics dialog, then
// delivers them via Mailgun (sendInvoiceEmail backend function) or as a
// ready-to-send .eml draft in Outlook / Apple Mail / Thunderbird. The .eml
// path is pure client-side and works even while Base44 integration credits
// or backend functions are unavailable.
const DOC_TYPES = [
  { id: "invoice", label: "Commercial Invoice" },
  { id: "packing_list", label: "Packing List" },
];

export default function EmailTjxEuropeDialog({ open, onClose, selectedPos, vendors = [], onSent }) {
  const [docTypes, setDocTypes] = useState({ invoice: true, packing_list: false });
  const [status, setStatus] = useState(null); // null | "generating" | "sending" | "sent" | "error"
  const [progressLabel, setProgressLabel] = useState("");
  const [mailgunError, setMailgunError] = useState("");
  const [generatedFiles, setGeneratedFiles] = useState([]);
  const [mailgunBusy, setMailgunBusy] = useState(false);
  const [outlookBusy, setOutlookBusy] = useState(false);
  const [emailTo, setEmailTo] = useState("TJXEuropeAP@tjx.com");
  const [editingTo, setEditingTo] = useState(false);
  const [emailBatchQueue, setEmailBatchQueue] = useState(null);
  const [processedBatchIds, setProcessedBatchIds] = useState(new Set());

  const { data: settingsList = [] } = useQuery({
    queryKey: ["appsettings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });
  const settings = settingsList[0] || {};

  useEffect(() => {
    if (open) {
      setGeneratedFiles([]);
      setStatus(null);
      setProgressLabel("");
      setMailgunError("");
      setEditingTo(false);
      setEmailBatchQueue(null);
      setProcessedBatchIds(new Set());
      setEmailTo(settings.tjx_europe_email_to || "TJXEuropeAP@tjx.com");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const europeFromEmail = settings.tjx_europe_from_email || null;
  const europeFromName = settings.tjx_europe_from_name || null;
  const bcc = settings.mailgun_bcc || "";
  const companyName = settings.company_name || "Shipping Hub";
  const subjectTemplate = settings.tjx_europe_email_template_subject || "Commercial Invoice - POs: {{po_numbers}}";
  const bodyTemplate = settings.tjx_europe_email_template_body || "Dear TJX Europe Accounts Payable,\n\nPlease find the following commercial invoices attached:\n\n{{po_list}}\n\nThank you,\n{{company_name}}";

  const toggleDoc = (id) => setDocTypes(p => ({ ...p, [id]: !p[id] }));

  const poList = selectedPos.map(po => `  - PO# ${formatPoNumber(po)}`).join("\n");
  const poNumbers = selectedPos.map(po => formatPoNumber(po)).join(", ");
  const selectedDocs = DOC_TYPES.filter(d => docTypes[d.id]).map(d => d.label).join(", ");

  const subject = subjectTemplate.replace(/\{\{po_numbers\}\}/g, poNumbers);
  const body = bodyTemplate
    .replace(/\{\{po_numbers\}\}/g, poNumbers)
    .replace(/\{\{po_list\}\}/g, poList)
    .replace(/\{\{company_name\}\}/g, companyName)
    .replace(/\{\{documents\}\}/g, selectedDocs);

  const getVendorForPo = (po) => vendors.find(v => v.id === po.vendor_id) || {};

  const isBusy = mailgunBusy || outlookBusy;
  const totalPdfs = selectedPos.length * DOC_TYPES.filter(d => docTypes[d.id]).length;

  // Shared PDF-generation step — builds the same vector-PDF documents the
  // APL dialog produces. Never touches Base44 credits.
  const generateAllFiles = async () => {
    setGeneratedFiles([]);
    const files = [];
    for (const po of selectedPos) {
      const vendor = getVendorForPo(po);
      const poLabel = formatPoNumber(po);

      const jobs = [];
      if (docTypes.invoice) jobs.push({ build: () => buildCommercialInvoicePdf({ po, vendor, customsId: settings.customs_id, settingsExporterName: settings.exporter_name, settingsExporterTitle: settings.exporter_title }), label: "invoice", filename: `Invoice_${poLabel}.pdf` });
      if (docTypes.packing_list) jobs.push({ build: () => buildPackingListPdf({ po, vendor }), label: "packing list", filename: `PackingList_${poLabel}.pdf` });

      for (const job of jobs) {
        setProgressLabel(`Generating ${job.label} for PO# ${poLabel}…`);
        const bytes = await job.build();
        const localUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        files.push({ filename: job.filename, bytes, poNumber: poLabel });
        setGeneratedFiles(prev => [...prev, { filename: job.filename, url: localUrl }]);
      }
    }
    return files;
  };

  const handleSendMailgun = async () => {
    setMailgunBusy(true);
    setStatus("generating");
    setMailgunError("");
    try {
      const files = await generateAllFiles();

      setStatus("sending");
      setProgressLabel("Sending email…");

      const attachments = files.map(f => ({ base64: uint8ToBase64(f.bytes), filename: f.filename }));
      await base44.functions.invoke("sendInvoiceEmail", {
        to: emailTo,
        subject,
        body,
        attachments,
        ...(bcc && { bcc }),
        ...(europeFromEmail && { from_email: europeFromEmail }),
        ...(europeFromName && { from_name: europeFromName }),
      });

      // Mark POs as invoiced once the invoice has been emailed for billing.
      const sentAt = new Date().toISOString();
      await Promise.all(selectedPos.map(po =>
        base44.entities.PurchaseOrder.update(po.id, {
          status: bumpStatus(po.status, "invoiced"),
        })
      ));

      if (onSent) onSent({ sentAt });
      setStatus("sent");
      setProgressLabel("");
    } catch (err) {
      setStatus("error");
      setMailgunError(friendlyErrorMessage(err, "Unknown error"));
      setProgressLabel("");
    } finally {
      setMailgunBusy(false);
    }
  };

  const handleOpenOutlook = async () => {
    setOutlookBusy(true);
    setStatus("generating");
    setMailgunError("");
    try {
      const files = await generateAllFiles();

      setProgressLabel("Preparing email draft(s)…");
      const batches = await buildEmailBatches({
        files,
        to: emailTo,
        from: europeFromEmail || (europeFromName ? `${europeFromName} <no-reply@shippinghub.app>` : "no-reply@shippinghub.app"),
        subject,
        body,
      });

      setProcessedBatchIds(new Set());
      setEmailBatchQueue(batches);
      setStatus(null);
      setProgressLabel("");
    } catch (err) {
      setStatus("error");
      setMailgunError(friendlyErrorMessage(err, "Unknown error"));
      setProgressLabel("");
    } finally {
      setOutlookBusy(false);
    }
  };

  const handleDownloadEml = (batch) => {
    downloadBatchEml(batch);
    setProcessedBatchIds(prev => new Set(prev).add(batch.id));
  };

  const handleDownloadZipFallback = (batch) => {
    downloadBatchZipAndOpenMailDraft(batch);
    setProcessedBatchIds(prev => new Set(prev).add(batch.id));
  };

  const closeBatchQueue = () => {
    const allDone = emailBatchQueue && processedBatchIds.size === emailBatchQueue.length;
    if (allDone) {
      const sentAt = new Date().toISOString();
      Promise.all(selectedPos.map(po =>
        base44.entities.PurchaseOrder.update(po.id, {
          status: bumpStatus(po.status, "invoiced"),
        })
      )).then(() => {
        if (onSent) onSent({ sentAt });
      });
    }
    setEmailBatchQueue(null);
    setProcessedBatchIds(new Set());
  };

  const handleClose = () => {
    setStatus(null);
    setProgressLabel("");
    setMailgunError("");
    setDocTypes({ invoice: true, packing_list: false });
    setGeneratedFiles([]);
    setEditingTo(false);
    setEmailBatchQueue(null);
    setProcessedBatchIds(new Set());
    onClose();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Email Commercial Invoices to TJX Europe</DialogTitle>
        </DialogHeader>

        {status === "sent" ? (
          <div className="py-6 text-center space-y-3">
            <div className="text-green-600 text-2xl font-semibold">✓ Email Sent!</div>
            <p className="text-sm text-gray-500">
              Sent to <strong>{emailTo}</strong> with {generatedFiles.length} PDF attachment{generatedFiles.length !== 1 ? "s" : ""}
            </p>
            <div className="border rounded-lg divide-y text-left">
              {generatedFiles.map(f => (
                <div key={f.filename} className="flex items-center gap-2 px-3 py-2">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700 flex-1 truncate">{f.filename}</span>
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium flex-shrink-0">Open ↗</a>
                </div>
              ))}
            </div>
            <Button onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-4 py-1 pr-1">

              {/* Selected POs */}
              <div>
                <Label className="text-xs text-gray-500">Selected Purchase Orders</Label>
                <div className="mt-1 bg-gray-50 rounded-lg p-3 text-sm space-y-0.5">
                  {selectedPos.map(po => (
                    <div key={po.id} className="font-medium text-gray-800">PO# {formatPoNumber(po)}</div>
                  ))}
                </div>
              </div>

              {/* Document Types */}
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">PDF Attachments to Generate &amp; Send</Label>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {DOC_TYPES.map(doc => (
                    <label key={doc.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                      <input type="checkbox" checked={docTypes[doc.id]} onChange={() => toggleDoc(doc.id)} className="rounded border-gray-300" disabled={isBusy} />
                      <FileText className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                      <span className="text-sm text-gray-700 flex-1">{doc.label}</span>
                      {docTypes[doc.id] && <span className="text-xs text-green-600 font-medium">will attach</span>}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {selectedPos.length} PO{selectedPos.length !== 1 ? "s" : ""} × {DOC_TYPES.filter(d => docTypes[d.id]).length} doc type{DOC_TYPES.filter(d => docTypes[d.id]).length !== 1 ? "s" : ""} = {totalPdfs} PDF{totalPdfs !== 1 ? "s" : ""} attached
                </p>
              </div>

              {/* ── Email Preview ── */}
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Email Preview</Label>
                <div className="border rounded-lg overflow-hidden text-xs">
                  <div className="bg-gray-50 px-3 py-2.5 border-b space-y-2">

                    {/* Editable To: */}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16 flex-shrink-0 font-medium">To:</span>
                      {editingTo ? (
                        <Input
                          autoFocus
                          value={emailTo}
                          onChange={e => setEmailTo(e.target.value)}
                          onBlur={() => setEditingTo(false)}
                          onKeyDown={e => e.key === "Enter" && setEditingTo(false)}
                          className="h-6 text-xs px-1.5 py-0 flex-1"
                        />
                      ) : (
                        <button
                          className="flex items-center gap-1.5 text-gray-800 font-medium hover:text-blue-600 flex-1 text-left group"
                          onClick={() => !isBusy && setEditingTo(true)}
                          disabled={isBusy}
                        >
                          {emailTo}
                          <Pencil className="w-3 h-3 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                        </button>
                      )}
                    </div>

                    {/* Subject */}
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-16 flex-shrink-0 font-medium">Subject:</span>
                      <span className="text-gray-800">{subject}</span>
                    </div>

                    {/* Attachments — appear as PDFs are generated */}
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-16 flex-shrink-0 font-medium">Files:</span>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {generatedFiles.length === 0 ? (
                          <span className="text-gray-400 italic">{totalPdfs} PDF{totalPdfs !== 1 ? "s" : ""} will be attached</span>
                        ) : (
                          generatedFiles.map(f => (
                            <a
                              key={f.filename}
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 bg-white border border-green-300 text-green-700 rounded px-1.5 py-0.5 hover:bg-green-50 font-medium"
                            >
                              <CheckCircle className="w-3 h-3 flex-shrink-0" />
                              {f.filename}
                            </a>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Body */}
                  <pre className="bg-white px-3 py-2 whitespace-pre-wrap font-sans text-gray-700 max-h-36 overflow-y-auto">{body}</pre>
                </div>
              </div>

              {/* Progress */}
              {isBusy && progressLabel && (
                <div className="flex items-center gap-2 text-sm text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  {progressLabel}
                </div>
              )}

              {/* Error */}
              {mailgunError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {mailgunError}
                </div>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 pt-3 border-t mt-2 flex-wrap gap-2 sm:justify-end">
              <Button variant="outline" onClick={handleClose} disabled={isBusy}>Cancel</Button>
              <Button
                variant="outline"
                onClick={handleSendMailgun}
                disabled={isBusy || selectedPos.length === 0 || !DOC_TYPES.some(d => docTypes[d.id])}
                className="border-teal-300 text-teal-700 hover:bg-teal-50"
              >
                {mailgunBusy
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{status === "sending" ? "Sending…" : "Generating…"}</>
                  : <><Send className="w-4 h-4 mr-2" />Send via Mailgun</>}
              </Button>
              <Button
                onClick={handleOpenOutlook}
                disabled={isBusy || selectedPos.length === 0 || !DOC_TYPES.some(d => docTypes[d.id])}
              >
                {outlookBusy
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparing…</>
                  : <><Mail className="w-4 h-4 mr-2" />Open in Outlook</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* Batch Review Dialog — shown for the Outlook path. Each email is
        listed for review before anything is downloaded or a mail draft
        opened. Same pattern as EmailAplDialog / TjxCanada.jsx. */}
    <Dialog open={!!emailBatchQueue} onOpenChange={(o) => { if (!o) closeBatchQueue(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Review {emailBatchQueue?.length || 0} Email{(emailBatchQueue?.length || 0) !== 1 ? "s" : ""} Before Sending
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-500 -mt-2 mb-2">
          Documents were split into
          {emailBatchQueue?.length > 1 ? ` ${emailBatchQueue.length} emails` : " one email"} to stay under the
          ~23MB attachment limit. Each row below is a separate email — review them all, then process each one.
          The <strong>.eml</strong> option opens as a ready-to-send draft in Outlook (or Apple Mail/Thunderbird)
          with attachments already in place; use the zip option instead if you're on Gmail/webmail with no
          desktop client.
        </p>
        <div className="space-y-4 py-2">
          {emailBatchQueue?.map((batch, i) => {
            const done = processedBatchIds.has(batch.id);
            return (
              <div key={batch.id} className={`border rounded-lg p-4 space-y-2 ${done ? "border-green-300 bg-green-50" : "border-gray-200 bg-white"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">
                    Email {i + 1} of {emailBatchQueue.length}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      ({(batch.totalBytes / 1024 / 1024).toFixed(1)}MB · {batch.fileNames.length} file{batch.fileNames.length !== 1 ? "s" : ""})
                    </span>
                  </span>
                  {done && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Downloaded</span>}
                </div>
                <div className="text-xs space-y-1">
                  <div><span className="text-gray-500">To:</span> <span className="font-medium">{batch.to}</span></div>
                  <div><span className="text-gray-500">Subject:</span> <span className="font-medium">{batch.subject}</span></div>
                </div>
                <Textarea value={batch.body} readOnly rows={4} className="text-xs bg-gray-50" />
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-24 overflow-y-auto">
                  {batch.fileNames.map((fn) => (
                    <div key={fn} className="flex items-center gap-2 px-3 py-1">
                      <FileText className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                      <span className="text-xs text-gray-700 truncate">{fn}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-1 min-w-[220px]"
                    onClick={() => handleDownloadEml(batch)}
                  >
                    <Mail className="h-3.5 w-3.5 mr-2" />
                    {done ? "Re-download .eml" : `Download Email #${i + 1} (.eml, attachments included)`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadZipFallback(batch)}
                    title="For Gmail/webmail with no desktop mail client"
                  >
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Zip only
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeBatchQueue}>
            {emailBatchQueue && processedBatchIds.size === emailBatchQueue.length ? "Done" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}