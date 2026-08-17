import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Star, ArrowLeft, Layers, ClipboardPaste } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import BulkEditDialog from "@/components/products/BulkEditDialog";
import FdcPasteDialog from "@/components/products/FdcPasteDialog";

const EMPTY_VENDOR = { company_name: "", address_line1: "", address_line2: "", city: "", state_province: "", postal_code: "", country: "Canada", contact_name: "", phone: "", fax: "", email: "", vendor_ein: "", vendor_number: "", is_default: false };
const EMPTY_PRODUCT = { item_number: "", vendor_style: "", description: "", upc_code: "", hs_code: "", country_of_origin: "USA", unit_price_cad: "", size: "750ml", units_per_carton: 6, carton_gross_weight_kg: "", carton_net_weight_kg: "", carton_cbm: "", is_food: true, ingredients: "", fdc_ingredients: [], fdc_consolidated_coo: "USA", fdc_product_of_animal_origin: "NO", shelf_life_days: "", storage_instructions: "" };
const EMPTY_ING = { name: "", pct_by_weight: "", country_of_origin: "USA", animal_or_plant: "PLANT/VEGETABLE MATERIAL", approval_number: "", heat_treatment: "", heat_treatment_eggs: "" };

export default function Vendors() {
  const qc = useQueryClient();
  // Vendor state
  const [editingVendor, setEditingVendor] = useState(null);
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR);

  // Product state
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [fdcPasteOpen, setFdcPasteOpen] = useState(false);

  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });

  // Vendor mutations
  const saveVendor = useMutation({
    mutationFn: (data) => editingVendor.id ? base44.entities.Vendor.update(editingVendor.id, data) : base44.entities.Vendor.create(data),
    onSuccess: () => { qc.invalidateQueries(["vendors"]); setEditingVendor(null); }
  });
  const delVendor = useMutation({
    mutationFn: (id) => base44.entities.Vendor.delete(id),
    onSuccess: () => qc.invalidateQueries(["vendors"])
  });

  // Product mutations
  const saveProduct = useMutation({
    mutationFn: (data) => editingProduct.id ? base44.entities.Product.update(editingProduct.id, data) : base44.entities.Product.create(data),
    onSuccess: () => { qc.invalidateQueries(["products"]); setEditingProduct(null); }
  });
  const delProduct = useMutation({
    mutationFn: (id) => base44.entities.Product.delete(id),
    onSuccess: () => { qc.invalidateQueries(["products"]); setDeleteTarget(null); }
  });

  const fv = (k) => (e) => setVendorForm(p => ({ ...p, [k]: e.target.value }));
  const fp = (k) => (e) => setProductForm(p => ({ ...p, [k]: e.target.value }));
  const fpn = (k) => (e) => setProductForm(p => ({ ...p, [k]: parseFloat(e.target.value) || "" }));

  const allSelected = products.length > 0 && selectedIds.length === products.length;
  const toggleAll = () => setSelectedIds(allSelected ? [] : products.map(p => p.id));
  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link to="/Dashboard"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Vendors & Products</h1>
        <Button onClick={() => { setEditingVendor({}); setVendorForm(EMPTY_VENDOR); }} size="sm" variant="outline">
          <Plus className="w-4 h-4 mr-1" />Add Vendor
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} disabled={products.length === 0}>
          <Layers className="w-4 h-4 mr-1" />
          {selectedIds.length > 0 ? `Bulk Edit (${selectedIds.length})` : "Bulk Edit"}
        </Button>
        <Button onClick={() => { setEditingProduct({}); setProductForm(EMPTY_PRODUCT); }} size="sm">
          <Plus className="w-4 h-4 mr-1" />Add Product
        </Button>
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Vendors */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Vendors ({vendors.length})</h2>
          {vendors.length === 0 && (
            <div className="text-center py-8 text-gray-400 bg-white rounded-xl border">No vendors yet. Add your company profile.</div>
          )}
          <div className="space-y-3">
            {vendors.map(v => (
              <div key={v.id} className="bg-white rounded-xl border p-4 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{v.company_name}</span>
                    {v.is_default && <Star className="w-4 h-4 text-yellow-500 fill-yellow-400" />}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{v.address_line1}{v.city && `, ${v.city}`}{v.country && `, ${v.country}`}</div>
                  <div className="text-sm text-gray-500">{v.email} {v.phone && `| ${v.phone}`}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => { setEditingVendor(v); setVendorForm(v); }}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => delVendor.mutate(v.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Products */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Product Catalog ({products.length})</h2>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 w-8"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
                  {["Item #", "Description", "UPC", "HS Code", "COO", "Price (CAD)", "Size", "Food", ""].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-10 text-gray-400">No products. Add items to your catalog.</td></tr>
                )}
                {products.map(p => (
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
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingProduct(p); setProductForm({ ...EMPTY_PRODUCT, ...p }); }}><Pencil className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(p)}><Trash2 className="w-3 h-3 text-red-500" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Vendor Dialog */}
      <Dialog open={!!editingVendor} onOpenChange={() => setEditingVendor(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingVendor?.id ? "Edit" : "Add"} Vendor</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[["Company Name","company_name"],["Vendor Number","vendor_number"],["EIN / Tax ID","vendor_ein"],["Contact Name","contact_name"],["Email","email"],["Phone","phone"],["Fax","fax"],["Address Line 1","address_line1"],["Address Line 2","address_line2"],["City","city"],["State / Province","state_province"],["Postal Code","postal_code"],["Country","country"]].map(([label, key]) => (
              <div key={key} className={key === "address_line1" || key === "company_name" ? "col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                <Input value={vendorForm[key] || ""} onChange={fv(key)} className="h-8 text-sm mt-1" />
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" id="is_default" checked={!!vendorForm.is_default} onChange={e => setVendorForm(p => ({ ...p, is_default: e.target.checked }))} />
              <Label htmlFor="is_default" className="text-sm">Set as default vendor</Label>
            </div>
          </div>
          <Button className="w-full mt-2" onClick={() => saveVendor.mutate(vendorForm)} disabled={saveVendor.isPending}>
            {saveVendor.isPending ? "Saving..." : "Save Vendor"}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={() => setEditingProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingProduct?.id ? "Edit" : "Add"} Product</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[["Item Number","item_number"],["Vendor Style","vendor_style"],["UPC Code (12-digit)","upc_code"],["HS / Schedule B Code","hs_code"],["Country of Origin","country_of_origin"],["Size","size"]].map(([label, key]) => (
              <div key={key}><Label className="text-xs">{label}</Label><Input value={productForm[key] || ""} onChange={fp(key)} className="h-8 text-sm mt-1" /></div>
            ))}
            <div className="col-span-2"><Label className="text-xs">Description</Label><Input value={productForm.description || ""} onChange={fp("description")} className="h-8 text-sm mt-1" /></div>
            {[["Unit Price (CAD)","unit_price_cad"],["Units per Carton","units_per_carton"],["Gross Weight/Carton (kg)","carton_gross_weight_kg"],["Net Weight/Carton (kg)","carton_net_weight_kg"],["Volume/Carton (CBM)","carton_cbm"],["Shelf Life (days)","shelf_life_days"]].map(([label, key]) => (
              <div key={key}><Label className="text-xs">{label}</Label><Input type="number" value={productForm[key] || ""} onChange={fpn(key)} className="h-8 text-sm mt-1" /></div>
            ))}
            <div className="col-span-2 flex items-center gap-3">
              <Switch checked={!!productForm.is_food} onCheckedChange={v => setProductForm(p => ({ ...p, is_food: v }))} />
              <Label className="text-sm">Food product (requires Food Detail Checklist)</Label>
            </div>
            {productForm.is_food && (
              <>
                <div className="col-span-2"><Label className="text-xs">Storage Instructions</Label><Input value={productForm.storage_instructions || ""} onChange={fp("storage_instructions")} className="h-8 text-sm mt-1" /></div>
                <div className="col-span-2">
                  <Label className="text-xs">Consolidated Country of Origin (FDC Tab 1)</Label>
                  <Input value={productForm.fdc_consolidated_coo || ""} onChange={fp("fdc_consolidated_coo")} className="h-8 text-sm mt-1" placeholder="e.g. USA" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Product of Animal Origin?</Label>
                  <select value={productForm.fdc_product_of_animal_origin || "NO"} onChange={e => setProductForm(p => ({ ...p, fdc_product_of_animal_origin: e.target.value }))} className="w-full border rounded-md px-2 py-1 text-sm mt-1 h-8">
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
                      <Button size="sm" variant="outline" onClick={() => setProductForm(p => ({ ...p, fdc_ingredients: [...(p.fdc_ingredients || []), { ...EMPTY_ING }] }))}>+ Add Row</Button>
                    </div>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-2 py-1 text-left">Ingredient</th>
                          <th className="px-2 py-1 text-left">% by Weight</th>
                          <th className="px-2 py-1 text-left">COO</th>
                          <th className="px-2 py-1 text-left">Animal/Plant</th>
                          <th className="px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(productForm.fdc_ingredients || []).map((ing, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-1 py-0.5"><Input value={ing.name} onChange={e => { const arr = [...productForm.fdc_ingredients]; arr[i] = { ...arr[i], name: e.target.value }; setProductForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" /></td>
                            <td className="px-1 py-0.5"><Input value={ing.pct_by_weight} onChange={e => { const arr = [...productForm.fdc_ingredients]; arr[i] = { ...arr[i], pct_by_weight: e.target.value }; setProductForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" placeholder="e.g. 0.98" /></td>
                            <td className="px-1 py-0.5"><Input value={ing.country_of_origin} onChange={e => { const arr = [...productForm.fdc_ingredients]; arr[i] = { ...arr[i], country_of_origin: e.target.value }; setProductForm(p => ({ ...p, fdc_ingredients: arr })); }} className="h-7 text-xs" /></td>
                            <td className="px-1 py-0.5">
                              <select value={ing.animal_or_plant || "PLANT/VEGETABLE MATERIAL"} onChange={e => { const arr = [...productForm.fdc_ingredients]; arr[i] = { ...arr[i], animal_or_plant: e.target.value }; setProductForm(p => ({ ...p, fdc_ingredients: arr })); }} className="border rounded px-1 py-0.5 text-xs h-7 w-full">
                                <option value="PLANT/VEGETABLE MATERIAL">Plant/Vegetable</option>
                                <option value="PRODUCT OF ANIMAL ORIGIN">Animal Origin</option>
                                <option value="NEITHER">Neither</option>
                              </select>
                            </td>
                            <td className="px-1 py-0.5"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setProductForm(p => ({ ...p, fdc_ingredients: p.fdc_ingredients.filter((_, j) => j !== i) }))}><Trash2 className="w-3 h-3 text-red-400" /></Button></td>
                          </tr>
                        ))}
                        {(productForm.fdc_ingredients || []).length === 0 && <tr><td colSpan={5} className="text-center py-3 text-gray-400">No ingredients added.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
          <Button className="w-full mt-2" onClick={() => saveProduct.mutate(productForm)} disabled={saveProduct.isPending}>
            {saveProduct.isPending ? "Saving..." : "Save Product"}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Delete Product Confirm */}
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
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => delProduct.mutate(deleteTarget.id)} disabled={delProduct.isPending}>
              {delProduct.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkEditDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        products={products}
        selectedIds={selectedIds}
        onSuccess={() => { qc.invalidateQueries(["products"]); setSelectedIds([]); }}
      />

      <FdcPasteDialog
        open={fdcPasteOpen}
        onClose={() => setFdcPasteOpen(false)}
        onApply={(ingredients) => setProductForm(p => ({ ...p, fdc_ingredients: ingredients }))}
      />
    </div>
  );
}