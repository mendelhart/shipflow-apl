import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Mail, Send, Loader2, FileText, CheckCircle, Download, X, AlertCircle, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import PrintWrapper from "@/components/shared/PrintWrapper";
import VectorPdfButton from "@/components/shared/VectorPdfButton";
import { formatPoNumber } from "@/utils/poNumber";
import CommercialInvoiceDoc from "@/components/documents/CommercialInvoiceDoc";
import { buildCommercialInvoicePdf, downloadBatchEml } from "@/lib/emailDocs";
import { renderEmailHtml, DEFAULT_FROM_EMAIL } from "@/lib/emailHtml";
import POGroupedSelector from "@/components/shared/POGroupedSelector";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { friendlyErrorMessage } from "@/lib/errors";
import { bumpStatus } from "@/domain/poStatus";

function applyTemplate(template, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v ?? ""), template);
}

// ============================================================================
// Inlined helpers for PDF generation + resilient email sending.
//
// Same pattern used in TjxCanada.jsx / CommercialInvoice.jsx: backend
// functions (sendInvoiceEmail) require a Builder plan, and even when
// available can run out of integration credits (402). This gives the same
// graceful degradation here: generate real PDFs client-side, try the
// backend send, and fall back to a reviewable batch of downloadable .eml
// files (or zips) if the backend path isn't available.
// ============================================================================

// ---- shared byte/base64 helpers --------------------------------------------

function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- error classification ---------------------------------------------------




// ---- PDF compression + batching (mirrors TjxCanada.jsx) --------------------

const SAFE_BATCH_BYTES = 23 * 1024 * 1024; // ~23MB per email, leaving headroom under Gmail/Outlook's 25MB cap

async function compressPdf(bytes) {
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const compressed = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return compressed.length < bytes.length ? compressed : bytes;
  } catch {
    return bytes;
  }
}

/**
 * Bin-pack already-generated PDF bytes into batches under SAFE_BATCH_BYTES,
 * regenerating subject/body per batch from templates so each batch's PO
 * list only reflects what's actually in that batch.
 */
async function buildEmailBatches({ files, to, subjectTemplate, bodyTemplate, companyName, fromEmail, logoUrl = "" }) {
  const compressedFiles = [];
  for (const f of files) {
    const before = f.bytes.length;
    const bytes = await compressPdf(f.bytes);
    console.log(`${f.filename}: ${(before / 1024 / 1024).toFixed(1)}MB → ${(bytes.length / 1024 / 1024).toFixed(1)}MB`);
    compressedFiles.push({ filename: f.filename, poNumber: f.poNumber, bytes });
  }

  const rawBatches = [];
  let current = [], currentSize = 0;
  for (const f of compressedFiles) {
    if (currentSize + f.bytes.length > SAFE_BATCH_BYTES && current.length > 0) {
      rawBatches.push(current);
      current = [f];
      currentSize = f.bytes.length;
    } else {
      current.push(f);
      currentSize += f.bytes.length;
    }
  }
  if (current.length > 0) rawBatches.push(current);

  return Promise.all(
    rawBatches.map(async (batchFiles, i) => {
      const poNumbers = batchFiles.map((f) => f.poNumber);
      const poList = poNumbers.map((po) => `  - PO# ${po}`).join("\n");
      const suffix = rawBatches.length > 1 ? ` (${i + 1}/${rawBatches.length})` : "";

      const subject = subjectTemplate.replace("{{po_numbers}}", poNumbers.join(", ")) + suffix;
      const body = bodyTemplate
        .replace("{{po_numbers}}", poNumbers.join(", "))
        .replace("{{po_list}}", poList)
        .replace("{{company_name}}", companyName)
        + (rawBatches.length > 1 ? `\n\n[Email ${i + 1} of ${rawBatches.length} — ${batchFiles.length} attachment(s)]` : "");

      const zip = new JSZip();
      let totalBytes = 0;
      for (const f of batchFiles) {
        zip.file(f.filename, f.bytes);
        totalBytes += f.bytes.length;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });

      return {
        id: `batch-${i}`,
        to,
        from: fromEmail || DEFAULT_FROM_EMAIL,
        subject,
        body,
        html: renderEmailHtml({ body, logoUrl, companyName }),
        poNumbers,
        fileNames: batchFiles.map((f) => f.filename),
        files: batchFiles.map((f) => ({ filename: f.filename, bytes: f.bytes })),
        totalBytes,
        zipBlob,
        zipName: rawBatches.length > 1 ? `invoices_${i + 1}_of_${rawBatches.length}.zip` : "invoices.zip",
      };
    })
  );
}

function downloadBatchZipAndOpenMailDraft(batch) {
  const zipUrl = URL.createObjectURL(batch.zipBlob);
  const a = document.createElement("a");
  a.href = zipUrl;
  a.download = batch.zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);

  const mailtoUrl = `mailto:${encodeURIComponent(batch.to)}?subject=${encodeURIComponent(
    batch.subject
  )}&body=${encodeURIComponent(batch.body + `\n\n(Invoices attached as ${batch.zipName} — please attach the file just downloaded.)`)}`;
  window.location.href = mailtoUrl;
}

// ---- .eml builder (real attachments, opens as a ready-to-send draft) ------

// ============================================================================
// Component
// ============================================================================

export default function Invoices() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const initPO = urlParams.get("po") || "";
  const [selectedIds, setSelectedIds] = useState(initPO ? [initPO] : []);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [mailgunStatus, setMailgunStatus] = useState(null); // null | "sending" | "sent" | "error: ..."
  const [statusWarning, setStatusWarning] = useState("");
  const [isOpeningOutlook, setIsOpeningOutlook] = useState(false);
  const [emailBatchQueue, setEmailBatchQueue] = useState(null);
  const [processedBatchIds, setProcessedBatchIds] = useState(new Set());
  const [emailResult, setEmailResult] = useState(null);
  const qc = useQueryClient();

  const { data: pos = [] } = useQuery({ queryKey: ["pos"], queryFn: () => base44.entities.PurchaseOrder.list("-created_date") });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });
  const { data: settingsList = [] } = useQuery({ queryKey: ["appsettings"], queryFn: () => base44.entities.AppSettings.list() });

  const settings = settingsList[0] || {};
  const europeTo = settings.tjx_europe_email_to || "accountspayable_invoices@tjxeurope.com";
  const europeSubjectTpl = settings.tjx_europe_email_template_subject || "Commercial Invoice - POs: {{po_numbers}}";
  const europeBodyTpl = settings.tjx_europe_email_template_body || "Dear TJX Europe Accounts Payable,\n\nPlease find the following commercial invoices attached:\n\n{{po_list}}\n\nThank you,\n{{company_name}}";

  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleGroup = (ids, allSelected) => setSelectedIds(prev =>
    allSelected ? prev.filter(x => !ids.includes(x)) : [...new Set([...prev, ...ids])]
  );

  const selectedPOs = pos.filter(p => selectedIds.includes(p.id));
  const getVendor = (po) => vendors.find(v => v.id === po.vendor_id);

  const openEmailDialog = () => {
    const poNumbers = selectedPOs.map(po => formatPoNumber(po)).join(", ");
    const poList = selectedPOs.map(po => `  - PO# ${formatPoNumber(po)}`).join("\n");
    const vars = { po_numbers: poNumbers, po_list: poList, company_name: settings.company_name || "Shipping Hub" };
    setEditSubject(applyTemplate(europeSubjectTpl, vars));
    setEditBody(applyTemplate(europeBodyTpl, vars));
    setMailgunStatus(null);
    setEmailDialogOpen(true);
  };

  const handleSendMailgun = async () => {
    setMailgunStatus("sending");
    try {
      // Generate a real PDF for every selected PO's invoice, then attach.
      const files = [];
      for (const po of selectedPOs) {
        const vendor = getVendor(po) || {};
        const bytes = await buildCommercialInvoicePdf({ po, vendor, customsId: settings.customs_id, settingsExporterName: settings.exporter_name, settingsExporterTitle: settings.exporter_title });
        files.push({ bytes, filename: `Invoice_${formatPoNumber(po)}.pdf`, poNumber: formatPoNumber(po) });
      }
      const attachments = files.map(f => ({ base64: uint8ToBase64(f.bytes), filename: f.filename }));
      await base44.functions.invoke("sendInvoiceEmail", { to: europeTo, subject: editSubject, body: editBody, attachments });

      // Invoice sent to TJX Europe — bump status forward to "invoiced"
      // (never downgrades a PO already further along). Soft-fails: a
      // problem here shouldn't undo the fact the email already sent.
      // Soft-fails, because a problem here must not undo the fact the email
      // already went — but it is no longer silent. Swallowing this to
      // console.error meant the emails went out, the statuses stayed put, the
      // screen went green, and a week later someone re-sent the same invoices
      // to TJX because nothing showed them as invoiced.
      const statusFailures = [];
      await Promise.all(selectedPOs.map(async (po) => {
        try {
          await base44.entities.PurchaseOrder.update(po.id, { status: bumpStatus(po.status, "invoiced") });
        } catch (statusErr) {
          console.error("Failed to update PO status to invoiced:", statusErr);
          statusFailures.push(formatPoNumber(po));
        }
      }));
      qc.invalidateQueries({ queryKey: ["pos"] });
      setStatusWarning(
        statusFailures.length
          ? `The email sent, but ${statusFailures.join(", ")} could not be marked as invoiced. ` +
            `Set the status by hand, or these will look unsent and may be sent again.`
          : ""
      );

      setMailgunStatus("sent");
    } catch (err) {
      // No silent auto-fallback — surface the error right in the dialog so
      // the person can decide whether to retry Mailgun or click "Open in
      // Outlook" instead.
      setMailgunStatus("error: " + friendlyErrorMessage(err, "Unknown error"));
    }
  };

  const handleOpenOutlook = async () => {
    setIsOpeningOutlook(true);
    try {
      const files = [];
      for (const po of selectedPOs) {
        const vendor = getVendor(po) || {};
        const bytes = await buildCommercialInvoicePdf({ po, vendor, customsId: settings.customs_id, settingsExporterName: settings.exporter_name, settingsExporterTitle: settings.exporter_title });
        files.push({ bytes, filename: `Invoice_${formatPoNumber(po)}.pdf`, poNumber: formatPoNumber(po) });
      }

      const batches = await buildEmailBatches({
        files,
        to: europeTo,
        subjectTemplate: europeSubjectTpl,
        bodyTemplate: europeBodyTpl,
        companyName: settings.company_name || "Shipping Hub",
        // This page emails TJX *Europe*; invoice_from_email is the TJX Canada
        // override and was the wrong knob. Previously hardcoded outright.
        fromEmail: settings.tjx_europe_from_email || DEFAULT_FROM_EMAIL,
        logoUrl: settings.logo_url || "",
      });

      setProcessedBatchIds(new Set());
      setEmailBatchQueue(batches);
      setEmailDialogOpen(false);
      setMailgunStatus(null);
    } catch (err) {
      alert("Error: " + friendlyErrorMessage(err, "Unknown error"));
    } finally {
      setIsOpeningOutlook(false);
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
      setEmailResult({ to: emailBatchQueue[0]?.to, batches: emailBatchQueue.length });
      // Every batch downloaded/opened — treat the invoice as sent to TJX
      // Europe and bump status forward to "invoiced".
      Promise.allSettled(selectedPOs.map(po =>
        base44.entities.PurchaseOrder.update(po.id, { status: bumpStatus(po.status, "invoiced") })
      )).then((results) => {
        qc.invalidateQueries({ queryKey: ["pos"] });
        const failed = results
          .map((r, i) => (r.status === "rejected" ? formatPoNumber(selectedPOs[i]) : null))
          .filter(Boolean);
        // Promise.all short-circuits: one rejection hid whether the others
        // succeeded, and the whole thing was logged to a console nobody reads.
        if (failed.length) {
          console.error("Failed to update PO status to invoiced:", failed);
          setStatusWarning(
            `The documents were prepared, but ${failed.join(", ")} could not be marked as invoiced. ` +
            `Set the status by hand so they are not sent twice.`
          );
        }
      });
    }
    setEmailBatchQueue(null);
    setProcessedBatchIds(new Set());
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Commercial Invoice</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={openEmailDialog} disabled={selectedIds.length === 0} className="border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40">
            <Mail className="w-4 h-4 mr-1" />
            Email to TJX Europe
          </Button>
          <Button size="sm" onClick={() => window.print()} disabled={selectedIds.length === 0} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40">
            <Printer className="w-4 h-4 mr-1" />
            Print{selectedIds.length > 0 ? ` ${selectedIds.length} Invoice${selectedIds.length > 1 ? "s" : ""}` : ""}
          </Button>
        </div>
      </div>

      {/* Result banner */}
      {statusWarning && (
        <div role="alert" className="mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3 no-print">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-900">{statusWarning}</p>
          <button onClick={() => setStatusWarning("")} className="ml-auto text-amber-400 hover:text-amber-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {emailResult && (
        <div className="mx-6 mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-3 no-print">
          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700">
            {emailResult.batches} email{emailResult.batches !== 1 ? "s" : ""} to {emailResult.to} downloaded — open the .eml file(s) to send directly, or attach the zip manually if you used that option.
          </p>
          <button onClick={() => setEmailResult(null)} className="ml-auto text-green-400 hover:text-green-600"><X className="h-4 w-4" /></button>
        </div>
      )}

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
        {selectedIds.length > 0 && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={openEmailDialog} className="border-blue-300 text-blue-700 hover:bg-blue-50">
              <Mail className="w-4 h-4 mr-1" />
              Email to TJX Europe
            </Button>
            <Button size="sm" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
              <Printer className="w-4 h-4 mr-1" />
              Print {selectedIds.length} Invoice{selectedIds.length > 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-8">
        {selectedPOs.length === 0 && (
          <div className="text-center py-12 text-gray-400">Select one or more POs above to generate invoices.</div>
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
              title={`Commercial_Invoice_${po.po_prefix}_${po.po_number}`}
              contentId={`inv-${po.id}`}
              extraActions={
                <VectorPdfButton
                  buildFn={() => buildCommercialInvoicePdf({ po, vendor, customsId: settings.customs_id, settingsExporterName: settings.exporter_name, settingsExporterTitle: settings.exporter_title })}
                  filename={`Commercial_Invoice_${po.po_prefix}_${po.po_number}.pdf`}
                />
              }
            >
              <CommercialInvoiceDoc po={po} vendor={vendor} settings={settings} />
            </PrintWrapper>
          );
        })}
      </div>

      {/* TJX Europe Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={(open) => { if (!open) { setEmailDialogOpen(false); setMailgunStatus(null); } }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Commercial Invoices to TJX Europe</DialogTitle>
          </DialogHeader>
          {mailgunStatus === "sent" ? (
            <div className="py-6 text-center">
              <div className="text-green-600 text-lg font-semibold mb-1">✓ Email Sent!</div>
              <p className="text-sm text-gray-500">Sent to {europeTo} with {selectedPOs.length} invoice{selectedPOs.length !== 1 ? "s" : ""} attached.</p>
              <Button className="mt-4" onClick={() => { setEmailDialogOpen(false); setMailgunStatus(null); }}>Close</Button>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">Attachments ({selectedPOs.length})</Label>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-28 overflow-y-auto">
                    {selectedPOs.map((po) => (
                      <div key={po.id} className="flex items-center gap-2 px-3 py-1.5">
                        <FileText className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                        <span className="text-xs text-gray-700 flex-1 truncate">Invoice_{formatPoNumber(po)}.pdf</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">To</Label>
                  <div className="h-8 px-3 py-1 text-sm border rounded-md bg-gray-50 text-gray-700">{europeTo}</div>
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">Subject</Label>
                  <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">Body</Label>
                  <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={8} className="text-sm" />
                </div>
                {mailgunStatus && mailgunStatus.startsWith("error") && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {mailgunStatus.replace(/^error:\s*/, "")}
                  </div>
                )}
              </div>
              <DialogFooter className="flex-wrap gap-2 sm:justify-end">
                <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>Cancel</Button>
                <Button
                  variant="outline"
                  onClick={handleSendMailgun}
                  disabled={mailgunStatus === "sending" || isOpeningOutlook}
                  className="border-teal-300 text-teal-700 hover:bg-teal-50"
                >
                  {mailgunStatus === "sending"
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating PDFs & Sending...</>
                    : <><Send className="w-4 h-4 mr-2" />Send via Mailgun</>}
                </Button>
                <Button onClick={handleOpenOutlook} disabled={mailgunStatus === "sending" || isOpeningOutlook}>
                  {isOpeningOutlook
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparing...</>
                    : <><Mail className="w-4 h-4 mr-2" />Open in Outlook</>}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Review Dialog — shown when backend email sending is blocked.
          Every email that will be produced is listed BEFORE anything is
          downloaded — same pattern as TjxCanada.jsx. */}
      <Dialog open={!!emailBatchQueue} onOpenChange={(open) => { if (!open) closeBatchQueue(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review {emailBatchQueue?.length || 0} Email{(emailBatchQueue?.length || 0) !== 1 ? "s" : ""} Before Sending
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 -mt-2 mb-2">
            Invoices were split into
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

      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  );
}
