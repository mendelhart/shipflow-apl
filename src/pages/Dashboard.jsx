import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Package, Tag, Container, Clipboard, Users, ChevronRight, AlertCircle, Settings, FolderOpen } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

const docCards = [
{ title: "Purchase Orders", desc: "Create and manage POs", icon: FileText, to: "/PurchaseOrders", color: "bg-blue-50 border-blue-200 text-blue-700" },
{ title: "Commercial Invoices", desc: "UK (50) & Germany (55)", icon: FileText, to: "/Invoices", color: "bg-green-50 border-green-200 text-green-700" },
{ title: "Packing Lists", desc: "Per PO packing documents", icon: Package, to: "/PackingLists", color: "bg-purple-50 border-purple-200 text-purple-700" },
{ title: "Carton & Pallet Labels", desc: "Print-ready labels", icon: Tag, to: "/Labels", color: "bg-orange-50 border-orange-200 text-orange-700" },
{ title: "SCLP", desc: "Security Container Load Plan", icon: Container, to: "/SCLP", color: "bg-red-50 border-red-200 text-red-700" },
{ title: "Food Detail Checklist", desc: "Required for dept 81 food", icon: Clipboard, to: "/FoodChecklist", color: "bg-yellow-50 border-yellow-200 text-yellow-700" },
{ title: "TJX Canada Invoices", desc: "Bulk PDF processing by PO#", icon: FileText, to: "/TjxCanada", color: "bg-teal-50 border-teal-200 text-teal-700" },
{ title: "Customer Documents", desc: "Invoice & packing list from any customer PO", icon: FileText, to: "/CustomerDocs", color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
{ title: "Commercial Invoice", desc: "From Brendamour warehouse report", icon: FileText, to: "/CommercialInvoice", color: "bg-cyan-50 border-cyan-200 text-cyan-700" },
{ title: "Pallet Slot Labels", desc: "4×6 product labels with barcode", icon: Tag, to: "/PalletLabels", color: "bg-pink-50 border-pink-200 text-pink-700" }];


export default function Dashboard() {
  // Distinct key: this fetches 50 rows while six other pages fetch all of them
  // under the same ["pos"] key. Visiting the Dashboard first primed the shared
  // cache with 50, so Purchase Orders then showed 50 of 300 with no loading
  // state and no indication anything was missing — earlier months simply
  // vanished, which is indistinguishable from having been deleted.
  const { data: pos = [] } = useQuery({ queryKey: ["pos", "recent50"], queryFn: () => base44.entities.PurchaseOrder.list("-created_date", 50) });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => base44.entities.Product.list() });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors"], queryFn: () => base44.entities.Vendor.list() });

  const [openGroup, setOpenGroup] = useState(null);

  // Group POs by upload month/year — consistent with other pages
  const poGroups = {};
  pos.forEach((po) => {
    let key = "Unknown Date";
    if (po.created_date) {try {key = format(new Date(po.created_date), "MMMM yyyy");} catch {}}
    if (!poGroups[key]) poGroups[key] = [];
    poGroups[key].push(po);
  });
  const groupKeys = Object.keys(poGroups);
  const defaultOpen = groupKeys[0] || null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipping Hub</h1>
          <p className="text-sm text-gray-500">APL-compliant document generator</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/Vendors" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border rounded-lg px-3 py-2">
            <Users className="w-4 h-4" /> Vendors & Products
          </Link>
          <Link to="/Settings" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border rounded-lg px-3 py-2">
            <Settings className="w-4 h-4" /> Settings
          </Link>
        </div>
      </div>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {vendors.length === 0 &&
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <span className="font-medium">Setup required: </span>
              <Link to="/Vendors" className="underline">Add your vendor profile</Link> and products before generating documents.
            </div>
          </div>
        }

        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Documents</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {docCards.map((card) =>
            <Link key={card.to} to={card.to} className={`border rounded-xl p-4 flex items-start gap-3 hover:shadow-md transition-shadow ${card.color}`}>
                <card.icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold text-sm">{card.title}</div>
                  <div className="text-xs opacity-75 mt-0.5">{card.desc}</div>
                </div>
                <ChevronRight className="w-4 h-4 ml-auto mt-0.5 opacity-50" />
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border p-4 text-center">
            <div className="text-3xl font-bold text-blue-600">{pos.length}</div>
            <div className="text-sm text-gray-500 mt-1">Purchase Orders</div>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <div className="text-3xl font-bold text-purple-600">{products.length}</div>
            <div className="text-sm text-gray-500 mt-1">Products</div>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <div className="text-3xl font-bold text-green-600">{vendors.length}</div>
            <div className="text-sm text-gray-500 mt-1">Vendors</div>
          </div>
        </div>

        {pos.length > 0 &&
        <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Purchase Orders</h2>
            <div className="space-y-2">
              {groupKeys.map((key) => {
              const isOpen = (openGroup === null ? defaultOpen : openGroup) === key;
              return (
                <div key={key} className="bg-white rounded-xl border overflow-hidden">
                    <button
                    onClick={() => setOpenGroup(isOpen ? false : key)}
                    className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                    
                      <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="font-semibold text-sm text-gray-800 flex-1">{key}</span>
                      <span className="text-xs text-gray-400 mr-2">{poGroups[key].length} PO{poGroups[key].length !== 1 ? "s" : ""}</span>
                      <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                    {isOpen &&
                  <div className="divide-y border-t">
                        {poGroups[key].map((po) =>
                    <Link key={po.id} to={`/PurchaseOrders?id=${po.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between px-5 py-2.5 hover:bg-gray-50">
                            <div>
                              <span className="font-medium text-sm">{po.po_number}</span>
                              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${po.po_prefix === "50" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                                {po.po_prefix === "50" ? "UK" : "Germany"}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs px-2 py-1 rounded-full ${po.status === "shipped" ? "bg-green-100 text-green-700" : po.status === "ready" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                                {po.status}
                              </span>
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            </div>
                          </Link>
                    )}
                      </div>
                  }
                  </div>);

            })}
            </div>
          </div>
        }
      </div>
    </div>);

}