import { FolderOpen, Plus, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

// Dropdown that lists previously saved SCLP records and lets the user
// load one or start a new blank SCLP.
export default function SavedSclpBrowser({ savedSclps, currentSclpId, open, onToggle, onLoad, onNew }) {
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={onToggle} className="gap-1.5">
        <FolderOpen className="w-3.5 h-3.5" />
        Saved SCLPs
        {savedSclps.length > 0 && (
          <span className="ml-1 bg-gray-100 text-gray-700 rounded-full px-1.5 py-0.5 text-xs font-semibold">
            {savedSclps.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
            <span className="text-sm font-semibold">Saved SCLPs</span>
            <button
              onClick={onNew}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y">
            {savedSclps.length === 0 && (
              <p className="text-xs text-gray-400 px-4 py-3 text-center">No saved SCLPs yet.</p>
            )}
            {savedSclps.map(record => (
              <button
                key={record.id}
                onClick={() => onLoad(record)}
                className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${currentSclpId === record.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">
                    {record.booking_number}
                  </span>
                  {currentSclpId === record.id && (
                    <CheckCircle className="w-3.5 h-3.5 text-blue-500" />
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {(record.po_ids || []).length} PO{record.po_ids?.length !== 1 ? "s" : ""}
                  {record.updated_date && ` · ${format(new Date(record.updated_date), "MMM d, yyyy")}`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}