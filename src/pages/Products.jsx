import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ArrowLeft, Layers, ClipboardPaste, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BulkEditDialog from "@/components/products/BulkEditDialog";
import FdcPasteDialog from "@/components/products/FdcPasteDialog";
import ProductAiToolbar from "@/components/products/ProductAiToolbar";
import ProductFormAi from "@/components/products/ProductFormAi";

const EMPTY = { item_number: "", vendor_style: "", description: "", upc_code: "", hs_code: "", country_of_origin: "USA", unit_price_cad: "", size: "750ml", units_per_carton: 6, carton_gross_weight_kg: "", carton_net_weight_kg: "", carton_cbm: "", is_food: true, ingredients: "", fdc_ingredients: [], fdc_consolidated_coo: "USA", fdc_product_of_animal_origin: "NO", shelf_life_days: "", storage_instructions: "" };

const EMPTY_ING = { name: "", pct_by_weight: "", country_of_origin: "USA", animal_or_plant: "PLANT/VEGETABLE MATERIAL", approval_number: "", heat_treatment: "", heat_treatment_eggs: "", e_number: "" };

// Fields that need to end up as numbers in the saved entity. Kept as raw
// strings in form state while typing (see `fn` below) and only parsed
// right before save — see buildPayload.
const NUMERIC_FIELDS = ["unit_price_cad", "units_per_carton", "carton_gross_weight_kg", "carton_net_weight_kg", "carton_cbm", "shelf_life_days"];

function buildPayload(data) {
  const payload = { ...data };
  for (const k of NUMERIC_FIELDS) {
    const v = payload[k];
    if (v === "" || v === undefined || v === null) { payload[k] = ""; continue; }
    const n = parseFloat(v);
    payload[k] = Number.isNaN(n) ? "" : n;
  }
  return payload;
}

export default function Products() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [fdcPasteOpen, setFdcPasteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [foodFilter, setFoodFilter] = useState("all"); // "all" | "food" | "non_food"
  const [sortField, setSortField] = useState("item_number");
  const [sortDir, setSortDir] = useState("asc"); // "asc" | "desc"

  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SORT_COLUMNS = {
    item_number: "item_number",
    description: "description",
    upc_code: "upc_code",
    hs_code: "hs_code",
    country_of_origin: "country_of_origin",
    unit_price_cad: "unit_price_cad",
    size: "size",
  };

  const filteredSortedProducts = products
    .filter(p => {
      if (foodFilter === "food" && !p.is_food) return false;
      if (foodFilter === "non_food" && p.is_food) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return [p.item_number, p.description, p.upc_code, p.vendor_style, p.hs_code]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const field = SORT_COLUMNS[sortField] || "item_number";
      let av = a[field], bv = b[field];
      // Numeric sort for the price column, string sort (case-insensitive) for everything else.
      if (field === "unit_price_cad") {
        av = parseFloat(av) || 0;
        bv = parseFloat(bv) || 0;
      } else {
        av = (av || "").toString().toLowerCase();
        bv = (bv || "").toString().toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const save = useMutation({
    mutationFn: (data) => editing.id ? base44.entities.Product.update(editing.id, data) : base44.entities.Product.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setEditing(null); }
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.Product.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setDeleteTarget(null); }
  });

  const openEdit = (p = null) => { setEditing(p || {}); setForm(p ? { ...EMPTY, ...p } : EMPTY); };
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  // FIX: previously did `parseFloat(e.target.value) || ""` on every
  // keystroke. Since 0 is falsy in JS, typing "0" instantly cleared the
  // field back to blank — and typing any decimal starting with 0 (like
  // "0.045", a completely normal CBM value) got mangled character by
  // character into something like "4" instead. Now this just keeps the
  // raw string while typing, exactly like the plain text fields already
  // do; numeric conversion happens once, at save time, in buildPayload().
  const fn = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const allSelected = filteredSortedProducts.length > 0 && filteredSortedProducts.every(p => selectedIds.includes(p.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : filteredSortedProducts.map(p => p.id));
  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const SortHeader = ({ field, children, className = "" }) => (
    <th className={`text-left px-3 py-2 font-medium text-gray-600 text-xs cursor-pointer select-none hover:text-gray-900 ${className}`} onClick={() => toggleSort(field)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sortField === field
          ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 text-gray-300" />}
      </span>
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link to="/Vendors"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Product Catalog</h1>
        <ProductAiToolbar products={products} selectedIds={selectedIds} onDone={() => qc.invalidateQueries({ queryKey: ["products"] })} />
        <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} disabled={products.length === 0}>
          <Layers className="w-4 h-4 mr-1" />
          {selectedIds.length > 0 ? `Bulk Edit (${selectedIds.length} selected)` : "Bulk Edit All"}
        </Button>
        <Button onClick={() => openEdit()} size="sm"><Plus className="w-4 h-4 mr-1" />Add Product</Button>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search item #, description, UPC, vendor style, HS code…"
              className="pl-9 h-9"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Select value={foodFilter} onValueChange={setFoodFilter}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              <SelectItem value="food">Food Only</SelectItem>
              <SelectItem value="non_food">Non-Food Only</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {filteredSortedProducts.length} of {products.length} products
          </span>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 w-8"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
                <SortHeader field="item_number">Item #</SortHeader>
                <SortHeader field="description">Description</SortHeader>
                <SortHeader field="upc_code">UPC</SortHeader>
                <SortHeader field="hs_code">HS Code</SortHeader>
                <SortHeader field="country_of_origin">COO</SortHeader>
                <SortHeader field="unit_price_cad">Price (CAD)</SortHeader>
                <SortHeader field="size">Size</SortHeader>
                <th className="text-left px-3 py-2 font-medium text-gray-600 text-xs">Food</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600 text-xs"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400">No products. Add items to your catalog.</td></tr>
              )}
              {products.length > 0 && filteredSortedProducts.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400">No products match your search/filter.</td></tr>
              )}
              {filteredSortedProducts.map(p => (
                <tr key={p.id} className={`hover:bg-gray-50 ${selectedIds.includes(p.id) ? "bg-blue-50" : ""}`}>
                  <td className="px-3 py-2"><Checkbox checked={selectedIds.includes(p.id)} onCheckedChange={() => toggleOne(p.id)} /></td>
                  <td className="px-3 py-2 font-mono text-xs">{p.item_number}</td>
                  <td className="px-3 py-2">{p.description}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.upc_code}</td>
                  <td className="px-3 py-2 text-xs">{p.hs_code}</td>
                  <td className="px-3 py-2 text-xs">{p.country_of_origin}</td>
                  <td className="px-3 py-2">CAD ${p.unit_price_cad}</td>
                  <td className="px-3 py-2 text-xs">{p.size}</td>
                  <td className="px-3 py-2">{p.is_food ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Food</span> : "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(p)}><Trash2 className="w-3 h-3 text-red-500" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BulkEditDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        products={products}
        selectedIds={selectedIds}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ["products"] }); setSelectedIds([]); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.description || deleteTarget?.item_number}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => del.mutate(deleteTarget.id)} disabled={del.isPending}>
              {del.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "Add"} Product</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[["Item Number","item_number"],["Vendor Style","vendor_style"],["UPC Code (12-digit)","upc_code"],["HS / Schedule B Code","hs_code"],["Country of Origin","country_of_origin"],["Size","size"]].map(([label, key]) => (
              <div key={key}><Label className="text-xs">{label}</Label><Input value={form[key] || ""} onChange={f(key)} className="h-8 text-sm mt-1" /></div>
            ))}
            <div className="col-span-2"><Label className="text-xs">Description</Label><Input value={form.description || ""} onChange={f("description")} className="h-8 text-sm mt-1" /></div>
            {[["Unit Price (CAD)","unit_price_cad"],["Units per Carton","units_per_carton"],["Gross Weight/Carton (kg)","carton_gross_weight_kg"],["Net Weight/Carton (kg)","carton_net_weight_kg"],["Volume/Carton (CBM)","carton_cbm"],["Shelf Life (days)","shelf_life_days"]].map(([label, key]) => (
              <div key={key}><Label className="text-xs">{label}</Label><Input type="number" value={form[key] ?? ""} onChange={fn(key)} className="h-8 text-sm mt-1" /></div>
            ))}
            <div className="col-span-2 flex items-center gap-3">
              <Switch checked={!!form.is_food} onCheckedChange={v => setForm(p => ({ ...p, is_food: v }))} />
              <Label className="text-sm">Food product (requires Food Detail Checklist)</Label>
            </div>
            {form.is_food && (
              <>
                <div className="col-span-2"><Label className="text-xs">Storage Instructions</Label><Input value={form.storage_instructions || ""} onChange={f("storage_instructions")} className="h-8 text-sm mt-1" /></div>
                <div className="col-span-2">
                  <Label className="text-xs">Consolidated Country of Origin (FDC Tab 1)</Label>
                  <Input value={form.fdc_consolidated_coo || ""} onChange={f("fdc_consolidated_coo")} className="h-8 text-sm mt-1" placeholder="e.g. USA" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Product of Animal Origin?</Label>
                  <select value={form.fdc_product_of_animal_origin || "NO"} onChange={e => setForm(p => ({ ...p, fdc_product_of_animal_origin: e.target.value }))} className="w-full border rounded-md px-2 py-1 text-sm mt-1 h-8">
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs font-semibold">FDC Ingredients (Form 2 – in descending order by weight)</Label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setFdcPasteOpen(true)}>
                        <ClipboardPaste className="w-3 h-3 mr-1" />Paste from Table
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setForm(p => ({ ...p, fdc_ingredients: [...(p.fdc_ingredients || []), { ...EMPTY_ING }] }))}>+ Add Row</Button>
                    </div>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-2 py-1 text-left">Ingredient</th>
                          <th className="px-2 py-1 text-left">E Number</th>
                          <th className="px-2 py-1 text-left">% by Weight</th>
                          <th className="px-2 py-1 text-left">COO</th>
                          <th className="px-2 py-1 text-left">Animal/Plant</th>
                          <th className="px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(form.fdc_ingredients || []).map((ing, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-1 py-0.5"><Input value={ing.name} onChange={e => { const arr = [...form.fdc_ingredients]; arr[i] = { ...arr[i], name: e.target.value }; setForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" /></td>
                            <td className="px-1 py-0.5"><Input value={ing.e_number || ""} onChange={e => { const arr = [...form.fdc_ingredients]; arr[i] = { ...arr[i], e_number: e.target.value }; setForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" placeholder="e.g. E300" /></td>
                            <td className="px-1 py-0.5"><Input value={ing.pct_by_weight} onChange={e => { const arr = [...form.fdc_ingredients]; arr[i] = { ...arr[i], pct_by_weight: e.target.value }; setForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" placeholder="e.g. 0.98 or <1%" /></td>
                            <td className="px-1 py-0.5"><Input value={ing.country_of_origin} onChange={e => { const arr = [...form.fdc_ingredients]; arr[i] = { ...arr[i], country_of_origin: e.target.value }; setForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" /></td>
                            <td className="px-1 py-0.5">
                              <select value={ing.animal_or_plant || "PLANT/VEGETABLE MATERIAL"} onChange={e => { const arr = [...form.fdc_ingredients]; arr[i] = { ...arr[i], animal_or_plant: e.target.value }; setForm(p => ({ ...p, fdc_ingredients: arr })); }} className="border rounded px-1 py-0.5 text-xs h-7 w-full">
                                <option value="PLANT/VEGETABLE MATERIAL">Plant/Vegetable</option>
                                <option value="PRODUCT OF ANIMAL ORIGIN">Animal Origin</option>
                                <option value="NEITHER">Neither</option>
                              </select>
                            </td>
                            <td className="px-1 py-0.5"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setForm(p => ({ ...p, fdc_ingredients: p.fdc_ingredients.filter((_, j) => j !== i) }))}><Trash2 className="w-3 h-3 text-red-400" /></Button></td>
                          </tr>
                        ))}
                        {(form.fdc_ingredients || []).length === 0 && <tr><td colSpan={6} className="text-center py-3 text-gray-400">No ingredients added.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <ProductFormAi form={form} setForm={setForm} />
              </>
            )}
          </div>
          <Button className="w-full mt-2" onClick={() => save.mutate(buildPayload(form))} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save Product"}
          </Button>
        </DialogContent>
      </Dialog>

      <FdcPasteDialog
        open={fdcPasteOpen}
        onClose={() => setFdcPasteOpen(false)}
        onApply={(ingredients) => setForm(p => ({ ...p, fdc_ingredients: ingredients }))}
      />
    </div>
  );
}