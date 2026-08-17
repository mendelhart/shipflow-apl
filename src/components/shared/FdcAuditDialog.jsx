import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, AlertCircle, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";

const SEVERITY_STYLE = {
  high: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50 border-red-200", label: "High" },
  medium: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50 border-amber-200", label: "Medium" },
  low: { icon: AlertCircle, color: "text-blue-600", bg: "bg-blue-50 border-blue-200", label: "Low" },
};

// Shared audit-results dialog used by the FDC page and the product form.
// Shows the Gemini audit summary + a list of issues grouped by severity,
// or a clean "no issues" state.
export default function FdcAuditDialog({ open, result, busy, busyStatus, error, onClose }) {
  const issues = result?.issues || [];
  const high = issues.filter((i) => i.severity === "high").length;
  const med = issues.filter((i) => i.severity === "medium").length;
  const low = issues.filter((i) => i.severity === "low").length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            FDC Compliance Audit
          </DialogTitle>
        </DialogHeader>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            {busyStatus || "Auditing with Gemini…"}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {!busy && result && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`text-xs px-2 py-1 rounded-full border ${high ? "bg-red-50 border-red-200 text-red-700" : "bg-gray-50 border-gray-200 text-gray-400"}`}>
                {high} High
              </span>
              <span className={`text-xs px-2 py-1 rounded-full border ${med ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-gray-50 border-gray-200 text-gray-400"}`}>
                {med} Medium
              </span>
              <span className={`text-xs px-2 py-1 rounded-full border ${low ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-gray-50 border-gray-200 text-gray-400"}`}>
                {low} Low
              </span>
            </div>

            <p className="text-sm text-gray-600 bg-gray-50 border rounded-lg p-3 mb-3">{result.summary}</p>

            {issues.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-4">
                <CheckCircle className="w-4 h-4" />
                No issues found — the data looks complete and consistent.
              </div>
            ) : (
              <div className="space-y-2">
                {issues.map((iss, i) => {
                  const s = SEVERITY_STYLE[iss.severity] || SEVERITY_STYLE.low;
                  const Icon = s.icon;
                  return (
                    <div key={i} className={`border rounded-lg p-3 ${s.bg}`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Icon className={`w-4 h-4 flex-shrink-0 ${s.color}`} />
                        <span className={`text-xs font-semibold ${s.color}`}>{s.label}</span>
                        {(iss.po || iss.product) && <span className="text-xs text-gray-500">· {iss.po || iss.product}</span>}
                        {iss.ingredient && <span className="text-xs text-gray-500">· {iss.ingredient}</span>}
                        {iss.field && <span className="text-xs text-gray-400">· {iss.field}</span>}
                      </div>
                      <p className="text-sm text-gray-800 mb-1">{iss.issue}</p>
                      {iss.recommendation && <p className="text-xs text-gray-500">→ {iss.recommendation}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}