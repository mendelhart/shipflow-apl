import { useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Folder } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatPoNumber } from "@/utils/poNumber";

/**
 * Groups POs by the month they SHIP into collapsible folders. Grouping used to
 * key off created_date - the day the PO was typed in - so an August sailing
 * entered in March filed itself under March.
 * Props:
 *  - pos: array of PO objects
 *  - selectedIds: array of selected PO ids
 *  - onToggle(id): toggle a single PO
 *  - onToggleGroup(ids): toggle all POs in a date group
 *  - mode: "multi" (default, checkboxes) | "single" (radio, calls onToggle with single id)
 */
export default function POGroupedSelector({ pos, selectedIds, onToggle, onToggleGroup, mode = "multi" }) {
  // Grouped by SHIP month, not the day the PO was entered — see
  // @/domain/poGrouping. Unscheduled POs come first.
  const ordered = groupPosByShipMonth(pos);
  const groups = Object.fromEntries(ordered.map((g) => [g.key, g.pos]));
  const sortedKeys = ordered.map((g) => g.key);

  // Open the first group (most recent) by default
  const [openGroups, setOpenGroups] = useState(() => {
    const init = {};
    if (sortedKeys.length > 0) init[sortedKeys[0]] = true;
    return init;
  });

  const toggleGroup = (key) => {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-1">
      {sortedKeys.map(dateKey => {
        const groupPOs = groups[dateKey];
        const groupIds = groupPOs.map(p => p.id);
        const allGroupSelected = groupIds.every(id => selectedIds.includes(id));
        const someGroupSelected = groupIds.some(id => selectedIds.includes(id));
        const isOpen = !!openGroups[dateKey];

        return (
          <div key={dateKey} className="border rounded-lg overflow-hidden">
            {/* Folder header */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
              onClick={() => toggleGroup(dateKey)}
            >
              {isOpen
                ? <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                : <Folder className="w-4 h-4 text-amber-500 shrink-0" />
              }
              <span className="text-xs font-semibold text-gray-700 flex-1">{dateKey}</span>
              <span className="text-xs text-gray-400 mr-2">{groupPOs.length} PO{groupPOs.length !== 1 ? "s" : ""}</span>
              {mode === "multi" && (
                <Checkbox
                  checked={allGroupSelected}
                  data-indeterminate={someGroupSelected && !allGroupSelected}
                  onCheckedChange={(e) => {
                    e.stopPropagation?.();
                    onToggleGroup && onToggleGroup(groupIds, allGroupSelected);
                  }}
                  onClick={e => e.stopPropagation()}
                  className="mr-1"
                />
              )}
              {isOpen
                ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              }
            </button>

            {/* PO list */}
            {isOpen && (
              <div className="divide-y">
                {groupPOs.map(p => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-4 py-2 cursor-pointer text-xs transition-colors ${
                      selectedIds.includes(p.id)
                        ? "bg-blue-50 text-blue-800"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {mode === "multi" ? (
                      <Checkbox
                        checked={selectedIds.includes(p.id)}
                        onCheckedChange={() => onToggle(p.id)}
                      />
                    ) : (
                      <input
                        type="radio"
                        checked={selectedIds.includes(p.id)}
                        onChange={() => onToggle(p.id)}
                        className="accent-blue-600"
                      />
                    )}
                    <span className="font-medium">{formatPoNumber(p)}</span>
                    {p.status && (
                      <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        p.status === "shipped" ? "bg-green-100 text-green-700" :
                        p.status === "submitted" ? "bg-blue-100 text-blue-700" :
                        p.status === "ready" ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-500"
                      }`}>
                        {p.status}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}