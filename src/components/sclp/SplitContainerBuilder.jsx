import { Input } from "@/components/ui/input";

// Given PO items and a split config, returns [container1Items, container2Items, container3Items]
// Each containerItem = { ...item, num_cartons: X, total_units: X }
//
// splits is keyed by LINE INDEX so duplicate item_numbers don't link.
// Each value is { c1, c2, c3 } (cartons per container; 0 = none in that container).
// Falls back to old single-number format (c1 qty, rest to c2) for saved records.
export function buildContainerItems(items, splits) {
  const containers = [[], [], []];
  items.forEach((item, idx) => {
    const total = parseInt(item.num_cartons) || 0;
    const raw = splits[idx] ?? splits[item.item_number];
    let c1qty, c2qty, c3qty;
    if (raw && typeof raw === "object") {
      c1qty = parseInt(raw.c1) || 0;
      c2qty = parseInt(raw.c2) || 0;
      c3qty = parseInt(raw.c3) || 0;
    } else {
      // Backward-compat: old format = single number (c1 qty), rest to c2
      c1qty = parseInt(raw ?? total) || 0;
      c2qty = Math.max(0, total - c1qty);
      c3qty = 0;
    }
    const upc = parseInt(item.units_per_carton) || 6;
    if (c1qty > 0) containers[0].push({ ...item, num_cartons: c1qty, total_units: c1qty * upc });
    if (c2qty > 0) containers[1].push({ ...item, num_cartons: c2qty, total_units: c2qty * upc });
    if (c3qty > 0) containers[2].push({ ...item, num_cartons: c3qty, total_units: c3qty * upc });
  });
  return containers;
}

// Normalize old single-number split values to { c1, c2, c3 } objects
function normalizeRowSplits(splits, items) {
  const out = {};
  items.forEach((item, idx) => {
    const raw = splits[idx] ?? splits[item.item_number];
    const total = parseInt(item.num_cartons) || 0;
    if (raw && typeof raw === "object") {
      out[idx] = { c1: parseInt(raw.c1) || 0, c2: parseInt(raw.c2) || 0, c3: parseInt(raw.c3) || 0 };
    } else {
      const c1 = parseInt(raw ?? total) || 0;
      out[idx] = { c1, c2: Math.max(0, total - c1), c3: 0 };
    }
  });
  return out;
}

export default function SplitContainerBuilder({ po, splits, onChange }) {
  const items = po.items || [];
  const norm = normalizeRowSplits(splits, items);

  const handleChange = (idx, container, val) => {
    const total = parseInt(items[idx]?.num_cartons) || 0;
    const parsed = Math.min(Math.max(0, parseInt(val) || 0), total);
    const cur = norm[idx];
    const updated = { ...cur, [container]: parsed };
    // Default split behavior: whatever is placed in container 1 balances
    // the remainder into container 2 (container 3 stays manual).
    if (container === "c1") {
      updated.c2 = Math.max(0, total - updated.c1 - (cur.c3 || 0));
    }
    onChange({ ...splits, [idx]: updated });
  };

  const totals = items.reduce((acc, item, idx) => {
    const r = norm[idx];
    acc.c1 += r.c1;
    acc.c2 += r.c2;
    acc.c3 += r.c3;
    acc.total += parseInt(item.num_cartons) || 0;
    return acc;
  }, { c1: 0, c2: 0, c3: 0, total: 0 });

  const balanceTotal = totals.total - totals.c1 - totals.c2 - totals.c3;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 no-print">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-amber-900">Split Container Configuration</span>
        <span className="text-xs text-amber-700 bg-amber-100 rounded px-2 py-0.5">Up to 3 containers — empty ones are skipped</span>
      </div>
      <p className="text-xs text-amber-700 mb-3">
        Enter cartons per container for each line. Use <strong>0</strong> if an item doesn't go in a container.
        Cartons per item must total the full quantity.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-amber-100">
              <th className="text-left text-xs font-semibold text-amber-800 p-2 border border-amber-200">Item #</th>
              <th className="text-left text-xs font-semibold text-amber-800 p-2 border border-amber-200">Description</th>
              <th className="text-center text-xs font-semibold text-amber-800 p-2 border border-amber-200">Total</th>
              <th className="text-center text-xs font-semibold text-blue-700 p-2 border border-amber-200">Container 1</th>
              <th className="text-center text-xs font-semibold text-green-700 p-2 border border-amber-200">Container 2</th>
              <th className="text-center text-xs font-semibold text-purple-700 p-2 border border-amber-200">Container 3</th>
              <th className="text-center text-xs font-semibold text-amber-800 p-2 border border-amber-200">Balance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const total = parseInt(item.num_cartons) || 0;
              const r = norm[idx];
              const balance = total - r.c1 - r.c2 - r.c3;
              return (
                <tr key={idx} className="bg-white">
                  <td className="p-2 border border-amber-200 font-mono text-xs">{item.item_number}</td>
                  <td className="p-2 border border-amber-200 text-xs text-gray-600 max-w-[180px] truncate">{item.description}</td>
                  <td className="p-2 border border-amber-200 text-center font-semibold text-xs">{total}</td>
                  <td className="p-2 border border-amber-200">
                    <Input type="number" min={0} max={total} value={r.c1}
                      onChange={e => handleChange(idx, "c1", e.target.value)}
                      className="h-7 text-xs text-center w-16 mx-auto block border-blue-300" />
                  </td>
                  <td className="p-2 border border-amber-200">
                    <Input type="number" min={0} max={total} value={r.c2}
                      onChange={e => handleChange(idx, "c2", e.target.value)}
                      className="h-7 text-xs text-center w-16 mx-auto block border-green-300" />
                  </td>
                  <td className="p-2 border border-amber-200">
                    <Input type="number" min={0} max={total} value={r.c3}
                      onChange={e => handleChange(idx, "c3", e.target.value)}
                      className="h-7 text-xs text-center w-16 mx-auto block border-purple-300" />
                  </td>
                  <td className={`p-2 border border-amber-200 text-center font-semibold text-xs ${balance !== 0 ? "text-red-600" : "text-gray-400"}`}>
                    {balance > 0 ? `${balance} left` : balance < 0 ? `+${Math.abs(balance)}` : "✓"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-amber-100 font-bold">
              <td colSpan={2} className="p-2 border border-amber-200 text-xs text-right">TOTALS:</td>
              <td className="p-2 border border-amber-200 text-center text-xs">{totals.total}</td>
              <td className="p-2 border border-amber-200 text-center text-xs text-blue-700">{totals.c1}</td>
              <td className="p-2 border border-amber-200 text-center text-xs text-green-700">{totals.c2}</td>
              <td className="p-2 border border-amber-200 text-center text-xs text-purple-700">{totals.c3}</td>
              <td className={`p-2 border border-amber-200 text-center text-xs ${balanceTotal !== 0 ? "text-red-600" : ""}`}>{balanceTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex gap-4 mt-3 text-xs text-amber-700 flex-wrap">
        <button onClick={() => {
          const all = {};
          items.forEach((i, idx) => { all[idx] = { c1: parseInt(i.num_cartons) || 0, c2: 0, c3: 0 }; });
          onChange(all);
        }} className="underline hover:text-amber-900">All → Container 1</button>
        <button onClick={() => {
          const half = {};
          items.forEach((i, idx) => {
            const total = parseInt(i.num_cartons) || 0;
            const c1 = Math.ceil(total / 2);
            half[idx] = { c1, c2: total - c1, c3: 0 };
          });
          onChange(half);
        }} className="underline hover:text-amber-900">Split 50/50</button>
        <button onClick={() => {
          const third = {};
          items.forEach((i, idx) => {
            const total = parseInt(i.num_cartons) || 0;
            const c1 = Math.ceil(total / 3);
            const c2 = Math.ceil((total - c1) / 2);
            third[idx] = { c1, c2, c3: total - c1 - c2 };
          });
          onChange(third);
        }} className="underline hover:text-amber-900">Split 3 ways</button>
        <button onClick={() => onChange({})} className="underline hover:text-amber-900">Reset</button>
      </div>
    </div>
  );
}