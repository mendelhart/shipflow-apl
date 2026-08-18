import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ArrowLeft, FileText, Package, Tag, Box, Clipboard, FolderOpen, Mail, AlertCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import POForm from "@/components/po/POForm.jsx";
import EmailAplDialog from "@/components/po/EmailAplDialog";
import EmailTjxEuropeDialog from "@/components/po/EmailTjxEuropeDialog";
import { formatPoNumber } from "@/utils/poNumber";
import { format } from "date-fns";
import { friendlyErrorMessage } from "@/lib/errors";
import { bumpStatus } from "@/domain/poStatus";
import { shipmentTotals } from '@/domain/shipmentTotals';

// Same 402/403 classification used across the other pages (TjxCanada.jsx,
// Invoices.jsx, CommercialInvoice.jsx, CustomerDocs.jsx, Settings.jsx).


const STATUS_COLORS = {
  draft: "bg-gray-100 text-gray-600",
  ready: "bg-blue-100 text-blue-700",
  booked: "bg-teal-100 text-teal-700",
  shipped: "bg-purple-100 text-purple-700",
  invoiced: "bg-green-100 text-green-700",
};


export default function PurchaseOrders() {
  const urlParams = new URLSearchParams(window.location.search);
  const selectedId = urlParams.get("id");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const openedIdRef = useRef(null);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedPoIds, setSelectedPoIds] = useState(new Set());
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showEuropeEmailDialog, setShowEuropeEmailDialog] = useState(false);
  const [singleAplPo, setSingleAplPo] = useState(null);

  const { data: pos = [], isLoading } = useQuery({ queryKey: ["pos"], queryFn: () => base44.entities.PurchaseOrder.list("-created_date") });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });

  useEffect(() => {
    // Open the deep-linked PO ONCE. `pos` gets a new array identity on every
    // refetch, so any invalidateQueries(["pos"]) elsewhere re-ran this and
    // re-opened the editor the user had just closed.
    if (selectedId && pos.length > 0 && openedIdRef.current !== selectedId) {
      const po = pos.find((p) => p.id === selectedId);
      if (po) {openedIdRef.current = selectedId;setEditing(po);setShowForm(true);}
    }
  }, [selectedId, pos]);

  const [recalcStatus, setRecalcStatus] = useState(null);
  const [recalcError, setRecalcError] = useState("");

  const recalcAllCbm = async () => {
    setRecalcStatus("running");
    setRecalcError("");
    let succeeded = 0;
    let failedPo = null;
    try {
      const products = await base44.entities.Product.list();
      const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
      const productByItemNumber = Object.fromEntries(products.filter((p) => p.item_number).map((p) => [p.item_number, p]));

      for (const stalePo of pos) {
        if (!stalePo.items?.length) continue;
        try {
          // Re-read immediately before writing. This used to rebuild the whole
          // `items` array from react-query's cache, which can be hours old, and
          // write it back wholesale — silently erasing line items a colleague
          // had added in the meantime, with no error anywhere.
          const [po] = await base44.entities.PurchaseOrder.filter({ id: stalePo.id });
          if (!po?.items?.length) continue;
          const updatedItems = po.items.map((item) => {
            const prod = (item.product_id ? productMap[item.product_id] : null) || (item.item_number ? productByItemNumber[item.item_number] : null);
            if (!prod) return item;
            return {
              ...item,
              cbm: prod?.carton_cbm ?? item.cbm,
              gross_weight_kg: prod?.carton_gross_weight_kg ?? item.gross_weight_kg,
              net_weight_kg: prod?.carton_net_weight_kg ?? item.net_weight_kg
            };
          });
          const { cbm: totalCbm, grossKg: totalGross, netKg: totalNet } = shipmentTotals(updatedItems);
          await base44.entities.PurchaseOrder.update(po.id, {
            items: updatedItems,
            total_cbm: parseFloat(totalCbm.toFixed(6)),
            total_gross_weight_kg: parseFloat(totalGross.toFixed(2)),
            total_net_weight_kg: parseFloat(totalNet.toFixed(2))
          });
          succeeded++;
        } catch (err) {
          // FIX: previously had no try/catch at all, so a single failed
          // update (network blip, or a 402 out-of-credits case) would
          // throw out of the whole loop, leaving the button stuck on
          // "running" forever with no indication of what happened or
          // which POs got updated before the failure.
          failedPo = po;
          throw err;
        }
      }
      qc.invalidateQueries({ queryKey: ["pos"] });
      setRecalcStatus("done");
      setTimeout(() => setRecalcStatus(null), 3000);
    } catch (err) {
      qc.invalidateQueries({ queryKey: ["pos"] }); // refresh so the UI reflects whatever DID succeed
      setRecalcStatus("error");
      const poLabel = failedPo ? ` (stopped at PO ${formatPoNumber(failedPo)})` : "";
      setRecalcError(`${succeeded} PO${succeeded !== 1 ? "s" : ""} updated before this failed${poLabel}: ${friendlyErrorMessage(err, "Unknown error")}`);
    }
  };

  const del = useMutation({
    mutationFn: (id) => base44.entities.PurchaseOrder.delete(id),
    onSuccess: () => {qc.invalidateQueries({ queryKey: ["pos"] });setDeleteTarget(null);}
  });

  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v.company_name]));

  const getGroupKey = (po) => {
    try {return format(new Date(po.created_date), "MMMM yyyy");}
    catch {return "Unknown Date";}
  };

  const groups = pos.reduce((acc, po) => {
    const key = getGroupKey(po);
    if (!acc[key]) acc[key] = [];
    acc[key].push(po);
    return acc;
  }, {});

  const groupKeys = Object.keys(groups);

  const [activeTab, setActiveTab] = useState(null);
  const defaultTab = groupKeys[0] || null;
  const currentTab = activeTab || defaultTab;

  const toggleSelect = (id) => {
    setSelectedPoIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedPos = pos.filter((p) => selectedPoIds.has(p.id));

  // ── Booking # (inline, per-PO) ─────────────────────────
  const [bookingOverrides, setBookingOverrides] = useState({});
  const [savingBooking, setSavingBooking] = useState({});
  const [bookingSavedFlash, setBookingSavedFlash] = useState({});
  const [bookingError, setBookingError] = useState("");

  const getBooking = (po) => bookingOverrides[po.id] !== undefined ? bookingOverrides[po.id] : (po.apl_booking_number || "");
  const handleBookingChange = (poId, val) => setBookingOverrides(prev => ({ ...prev, [poId]: val }));

  const saveBooking = async (po) => {
    const val = (bookingOverrides[po.id] !== undefined ? bookingOverrides[po.id] : (po.apl_booking_number || "")).trim();
    setSavingBooking(prev => ({ ...prev, [po.id]: true }));
    setBookingError("");
    try {
      const newStatus = val ? bumpStatus(po.status, "booked") : (po.status || "draft");
      // This check used to re-read the react-query CACHE after invalidating
      // it, and report failure when the value didn't match. If the refetch
      // itself failed (retry gives up), the cache still held pre-save data, so
      // a write that succeeded was reported as "didn't actually save" and the
      // user submitted it again.
      //
      // On Postgres there is no silent field-dropping to defend against:
      // update() returns the stored row, and an unknown column is a thrown
      // PGRST204. Trust the returned row.
      const saved = await base44.entities.PurchaseOrder.update(po.id, {
        apl_booking_number: val,
        status: newStatus,
      });
      qc.invalidateQueries({ queryKey: ["pos"] });
      if ((saved?.apl_booking_number || "") !== val) {
        setBookingError(
          `Booking # did not save for PO ${formatPoNumber(po)}. Please try again.`
        );
      } else {
        setBookingOverrides(prev => { const next = { ...prev }; delete next[po.id]; return next; });
        setBookingSavedFlash(prev => ({ ...prev, [po.id]: true }));
        setTimeout(() => setBookingSavedFlash(prev => ({ ...prev, [po.id]: false })), 2000);
      }
    } catch (err) {
      setBookingError(friendlyErrorMessage(err, `Failed to save booking # for PO ${formatPoNumber(po)}.`));
    } finally {
      setSavingBooking(prev => ({ ...prev, [po.id]: false }));
    }
  };

  // Pallet calculator constants
  const CASES_PER_PALLET_STD = 112;
  const CASES_PER_PALLET_MAX = 140;

  const getPalletConfig = (po) => {
    const totalCases = (po.items || []).reduce((s, i) => s + (parseInt(i.num_cartons) || 0), 0);
    if (totalCases === 0) return null;
    const containerSize = po.container_size || "40HC";
    const maxPallets = containerSize.startsWith("20") ? 10 : 21;
    const minStd = Math.ceil(totalCases / CASES_PER_PALLET_STD);
    const minMax = Math.ceil(totalCases / CASES_PER_PALLET_MAX);
    const fitsAtStd = minStd <= maxPallets;
    const fitsAtMax = minMax <= maxPallets;
    return { totalCases, maxPallets, minStd, minMax, fitsAtStd, fitsAtMax };
  };

  if (showForm) {
    return <POForm po={editing} onClose={() => {openedIdRef.current = null;setShowForm(false);setEditing(null);navigate("/PurchaseOrders");}} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link to="/Dashboard"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Purchase Orders</h1>
        {selectedPoIds.size > 0 &&
        <Button size="sm" variant="outline" className="border-purple-400 text-purple-700 hover:bg-purple-50" onClick={() => setShowEuropeEmailDialog(true)}>
            <Mail className="w-4 h-4 mr-1" />
            Email to TJX Europe
          </Button>
        }
        {selectedPoIds.size > 0 &&
        <Button size="sm" variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-50" onClick={() => setShowEmailDialog(true)}>
            <Mail className="w-4 h-4 mr-1" />
            Email {selectedPoIds.size} PO{selectedPoIds.size > 1 ? "s" : ""} to APL
          </Button>
        }
        {selectedPoIds.size > 0 &&
        <Button size="sm" variant="ghost" className="text-gray-500" onClick={() => setSelectedPoIds(new Set())}>
            Clear
          </Button>
        }
        


        
        <Button onClick={() => {setEditing(null);setShowForm(true);}} size="sm">
          <Plus className="w-4 h-4 mr-1" />New PO
        </Button>
      </div>

      {/* Recalc CBM error banner */}
      {recalcError && (
        <div className="mx-6 mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{recalcError}</span>
          <button onClick={() => setRecalcError("")} className="text-red-400 hover:text-red-600 text-xs font-medium">Dismiss</button>
        </div>
      )}

      {/* Booking # error banner */}
      {bookingError && (
        <div className="mx-6 mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{bookingError}</span>
          <button onClick={() => setBookingError("")} className="text-red-400 hover:text-red-600 text-xs font-medium">Dismiss</button>
        </div>
      )}

      <div className="p-6 max-w-5xl mx-auto">
        {isLoading && <div className="text-center py-12 text-gray-400">Loading...</div>}
        {!isLoading && pos.length === 0 &&
        <div className="text-center py-12 text-gray-400">No purchase orders yet. Create your first PO.</div>
        }

        {groupKeys.length > 0 &&
        <>
            <div className="flex flex-wrap gap-2 mb-4">
              {groupKeys.map((key) =>
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              currentTab === key ?
              "bg-blue-600 text-white border-blue-600" :
              "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`
              }>
              
                  <FolderOpen className="w-3.5 h-3.5" />
                  {key}
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-semibold ${currentTab === key ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}>
                    {groups[key].length}
                  </span>
                </button>
            )}
            </div>

            <div className="space-y-3">
              {(groups[currentTab] || []).map((po) => {
              const isSelected = selectedPoIds.has(po.id);
              // FIX: strict string comparison — if po_prefix is ever stored
              // as a number rather than a string, this always evaluated to
              // false and every PO showed as "Germany (55)" regardless of
              // its actual prefix. String()-coerce both sides so it works
              // no matter which type the field actually holds.
              const isUK = String(po.po_prefix) === "50";
              return (
                <div key={po.id} className={`bg-white rounded-xl border p-4 transition-colors ${isSelected ? "border-blue-400 bg-blue-50" : ""}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        {/* Checkbox */}
                        <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(po.id)}
                        className="mt-1.5 rounded border-gray-300 cursor-pointer" />
                      
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-lg">{formatPoNumber(po)}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isUK ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                              {isUK ? "UK (50)" : "Germany (55)"}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[po.status] || STATUS_COLORS.draft}`}>
                              {po.status || "draft"}
                            </span>
                            {po.apl_booking_number && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">
                                📦 Booked: {po.apl_booking_number}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {po.invoice_number && <span className="mr-3">Invoice: {po.invoice_number}</span>}
                            {po.vendor_id && vendorMap[po.vendor_id] && <span className="mr-3">Vendor: {vendorMap[po.vendor_id]}</span>}
                            {po.total_cartons && <span className="mr-3">{po.total_cartons} cartons</span>}
                            {po.freight_terms && <span>{po.freight_terms}</span>}
                          </div>
                          {(() => {
                            const cfg = getPalletConfig(po);
                            if (!cfg) return null;
                            const { totalCases, maxPallets, minStd, minMax, fitsAtStd, fitsAtMax } = cfg;
                            const pallets = fitsAtStd ? minStd : minMax;
                            const casesPerPlt = fitsAtStd ? CASES_PER_PALLET_STD : CASES_PER_PALLET_MAX;
                            const color = fitsAtStd ? "bg-green-50 border-green-200 text-green-700" : fitsAtMax ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-red-50 border-red-200 text-red-600";
                            const icon = fitsAtStd ? "✓" : fitsAtMax ? "⚠" : "✗";
                            return (
                              <div className={`inline-flex items-center gap-2 mt-1.5 text-xs px-2.5 py-1 rounded-lg border font-medium ${color}`}>
                                <span>{icon}</span>
                                <span>{totalCases} cases</span>
                                <span className="opacity-40">·</span>
                                <span>{pallets} pallets @ {casesPerPlt}/plt</span>
                                <span className="opacity-40">·</span>
                                <span>fits {maxPallets}-plt {(po.container_size || "40HC").startsWith("20") ? "20'" : "40'"} container{!fitsAtStd && fitsAtMax ? " (max density)" : !fitsAtMax ? " — overflow!" : ""}</span>
                                {po.total_pallets > 0 && <span className="opacity-40">·</span>}
                                {po.total_pallets > 0 && <span>saved: {po.total_pallets} plt</span>}
                              </div>
                            );
                          })()}
                          <div className="flex items-center gap-2 mt-2">
                            <Input
                              placeholder="Booking #"
                              value={getBooking(po)}
                              onChange={e => handleBookingChange(po.id, e.target.value)}
                              className="h-7 text-xs w-40"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={savingBooking[po.id]}
                              onClick={() => saveBooking(po)}
                              className={`h-7 text-xs gap-1 ${bookingSavedFlash[po.id] ? "border-green-400 text-green-700 bg-green-50" : ""}`}
                            >
                              {savingBooking[po.id] ? "Saving…" : bookingSavedFlash[po.id] ? "✓ Saved" : "Save Booking #"}
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-3">
                            {[
                          { label: "Invoice", to: `/Invoices?po=${po.id}`, icon: FileText },
                          { label: "Packing List", to: `/PackingLists?po=${po.id}`, icon: Package },
                          { label: "Labels", to: `/Labels?po=${po.id}`, icon: Tag },
                          { label: "SCLP", to: `/SCLP?po=${po.id}`, icon: Box },
                          { label: "Food Check", to: `/FoodChecklist?po=${po.id}`, icon: Clipboard }].
                          map((btn) =>
                          <Link key={btn.label} to={btn.to} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-md text-gray-700">
                                <btn.icon className="w-3 h-3" />{btn.label}
                              </Link>
                          )}
                            <button
                            onClick={() => setSingleAplPo(po)}
                            className="flex items-center gap-1 text-xs bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md text-blue-700 border border-blue-200">
                            
                              <Mail className="w-3 h-3" />Email APL
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button variant="ghost" size="icon" onClick={() => {setEditing(po);setShowForm(true);}}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(po)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                      </div>
                    </div>
                  </div>);

            })}
            </div>
          </>
        }
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete PO <strong>{deleteTarget ? formatPoNumber(deleteTarget) : ""}</strong>. This action cannot be undone.
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

      <EmailAplDialog
        open={showEmailDialog}
        onClose={() => setShowEmailDialog(false)}
        selectedPos={selectedPos}
        vendors={vendors}
        onSent={() => qc.invalidateQueries({ queryKey: ["pos"] })} />
      
      <EmailAplDialog
        open={!!singleAplPo}
        onClose={() => setSingleAplPo(null)}
        selectedPos={singleAplPo ? [singleAplPo] : []}
        vendors={vendors}
        onSent={() => qc.invalidateQueries({ queryKey: ["pos"] })} />
      
      <EmailTjxEuropeDialog
        open={showEuropeEmailDialog}
        onClose={() => setShowEuropeEmailDialog(false)}
        selectedPos={selectedPos}
        vendors={vendors}
        onSent={() => qc.invalidateQueries({ queryKey: ["pos"] })} />
      
    </div>);

}