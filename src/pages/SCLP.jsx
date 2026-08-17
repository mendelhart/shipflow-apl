import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, SplitSquareHorizontal, Square, Save,
  ChevronDown, ChevronUp, Tag, Printer, Download,
  CheckCircle, Edit2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PrintWrapper from "@/components/shared/PrintWrapper";
import { formatPoNumber } from "@/utils/poNumber";
import SCLPDoc from "@/components/documents/SCLPDoc";
import SplitContainerBuilder, { buildContainerItems } from "@/components/sclp/SplitContainerBuilder";
import POGroupedSelector from "@/components/shared/POGroupedSelector";
import SavedSclpBrowser from "@/components/sclp/SavedSclpBrowser";
import { buildSCLPHtml, openSCLPWindow } from "@/utils/sclpExport";
import { openPalletLabelsWindow } from "@/utils/palletLabels";
import { format } from "date-fns";

const FIELD_DEFAULTS = {
  loadType: "FCL – Full Container Load",
  containerSize: "40' HC (High Cube)",
  containerNumber: "",
  sealNumber: "",
  apllBookingNumber: "",
  vesselName: "",
  voyageNumber: "",
  portOfLoading: "CAMTR",
  actualDeliveryDate: "",
};

// Status auto-progresses forward only (draft < ready < booked < shipped <
// invoiced) — never downgrades a PO that's already further along.
const STATUS_ORDER = ["draft", "ready", "booked", "shipped", "invoiced"];
function bumpStatus(current, target) {
  const cur = STATUS_ORDER.indexOf(current || "draft");
  const tgt = STATUS_ORDER.indexOf(target);
  if (tgt === -1) return current || "draft";
  return tgt > cur ? target : (current || "draft");
}

// Compares two PO-id arrays regardless of order — used to find a
// previously saved SCLP that exactly matches the current PO selection.
function sameIdSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  return [...a].sort().join(",") === [...b].sort().join(",");
}

const emptyContainers = () => [
  { number: "", seal: "", pallets: "" },
  { number: "", seal: "", pallets: "" },
  { number: "", seal: "", pallets: "" },
];

// Pallet density constants for the auto-distribute calculator.
const CASES_PER_PALLET_STD = 112;
const CASES_PER_PALLET_MAX = 140;

export default function SCLP() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedPOs, setSelectedPOs] = useState([]);
  const [mode, setMode] = useState("single");
  const [splits, setSplits] = useState({});
  const [formOpen, setFormOpen] = useState(true);

  const [fields, setFields] = useState(FIELD_DEFAULTS);
  const [palletOverrides, setPalletOverrides] = useState({});
  const [savingPallets, setSavingPallets] = useState({});

  // Up to 3 containers (split mode): number / seal / pallets each.
  const [containers, setContainers] = useState(emptyContainers);

  // SCLP record state
  const [currentSclpId, setCurrentSclpId] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [savedRecordsOpen, setSavedRecordsOpen] = useState(false);

  const { data: pos = [] } = useQuery({
    queryKey: ["pos"],
    queryFn: () => base44.entities.PurchaseOrder.list("-created_date"),
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => base44.entities.Vendor.list(),
  });

  const { data: savedSclps = [], refetch: refetchSclps } = useQuery({
    queryKey: ["sclps"],
    queryFn: () => base44.entities.SCLP.list("-created_date"),
  });

  const selectedPOObjects = pos.filter(p => selectedPOs.includes(p.id));
  const vendorConflict = [...new Set(selectedPOObjects.map(p => p.vendor_id))].length > 1;

  const setField = (key, val) => {
    setFields(prev => ({ ...prev, [key]: val }));
    setSaveStatus("idle");
  };

  const setContainerField = (idx, field, val) => {
    setContainers(prev => prev.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
    setSaveStatus("idle");
  };

  const togglePO = (id) => {
    setSelectedPOs(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    setSplits({});
    setMode("single");
    setCurrentSclpId(null);
    setSaveStatus("idle");
  };

  // Auto-load a previously saved SCLP whenever the current PO selection
  // exactly matches one (so container#/seal#/vessel/etc. reappear).
  useEffect(() => {
    if (selectedPOs.length === 0 || currentSclpId) return;
    const match = savedSclps.find(r => sameIdSet(r.po_ids || [], selectedPOs));
    if (match) handleLoadSclp(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPOs, savedSclps]);

  // ── Pallets ─────────────────────────────────────────────
  const handlePalletChange = (poId, val) => {
    setPalletOverrides(prev => ({ ...prev, [poId]: val }));
    setSaveStatus("idle");
  };

  const savePallets = async (po) => {
    const override = palletOverrides[po.id];
    if (override === undefined || override === "") return;
    setSavingPallets(prev => ({ ...prev, [po.id]: true }));
    try {
      await base44.entities.PurchaseOrder.update(po.id, { total_pallets: parseInt(override) });
      queryClient.invalidateQueries({ queryKey: ["pos"] });
    } finally {
      setSavingPallets(prev => ({ ...prev, [po.id]: false }));
    }
  };

  const getPallets = (po) => (palletOverrides[po.id] !== undefined ? palletOverrides[po.id] : (po.total_pallets ?? ""));
  const getPalletCount = (po) => {
    const ov = palletOverrides[po.id];
    return ov !== undefined && ov !== "" ? (parseInt(ov) || 0) : (parseInt(po.total_pallets) || 0);
  };
  const totalPalletsForSelected = selectedPOObjects.reduce((s, po) => s + getPalletCount(po), 0);

  const getContainerMaxPallets = () => (fields.containerSize?.startsWith("20'") ? 10 : 21);

  const handleAutoDistributePallets = () => {
    const maxPallets = getContainerMaxPallets();
    const totalCases = selectedPOObjects.reduce(
      (s, po) => s + (po.items || []).reduce((ss, item) => ss + (parseInt(item.num_cartons) || 0), 0),
      0
    );
    if (totalCases === 0) return;

    const minStd = Math.ceil(totalCases / CASES_PER_PALLET_STD);
    const minMax = Math.ceil(totalCases / CASES_PER_PALLET_MAX);
    const targetPallets = minStd <= maxPallets ? minStd : minMax;

    const poCartons = selectedPOObjects.map(po => ({
      po,
      cartons: (po.items || []).reduce((s, item) => s + (parseInt(item.num_cartons) || 0), 0),
    }));

    const newOverrides = {};
    let assigned = 0;
    poCartons.forEach(({ po, cartons }, idx) => {
      if (idx === poCartons.length - 1) {
        newOverrides[po.id] = Math.max(1, targetPallets - assigned);
      } else {
        const share = Math.max(1, Math.round((cartons / totalCases) * targetPallets));
        newOverrides[po.id] = share;
        assigned += share;
      }
    });

    setPalletOverrides(prev => ({ ...prev, ...newOverrides }));
    setSaveStatus("idle");
  };

  // ── Save / Load / New ────────────────────────────────────
  const handleSaveSclp = async () => {
    if (selectedPOObjects.length === 0) return;
    if (!fields.apllBookingNumber.trim()) {
      alert("Please enter an APLL Booking Number before saving.");
      return;
    }

    setSaveStatus("saving");
    const payload = {
      booking_number: fields.apllBookingNumber.trim(),
      po_ids: selectedPOs,
      shipment_info: fields,
      pallet_overrides: palletOverrides,
      mode,
      splits,
      containers: containers.map(c => ({
        number: c.number,
        seal: c.seal,
        pallets: c.pallets === "" ? null : Number(c.pallets),
      })),
    };

    try {
      if (currentSclpId) {
        await base44.entities.SCLP.update(currentSclpId, payload);
      } else {
        const created = await base44.entities.SCLP.create(payload);
        setCurrentSclpId(created.id);
      }
      await refetchSclps();

      // Saving means these POs are shipping — bump status forward only.
      try {
        await Promise.all(selectedPOObjects.map(po =>
          base44.entities.PurchaseOrder.update(po.id, { status: bumpStatus(po.status, "shipped") })
        ));
        queryClient.invalidateQueries({ queryKey: ["pos"] });
      } catch (statusErr) {
        console.error("Failed to update PO status to shipped:", statusErr);
      }

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      console.error("Failed to save SCLP:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 4000);
    }
  };

  const handleLoadSclp = (record) => {
    setCurrentSclpId(record.id);
    setSelectedPOs(record.po_ids || []);
    setFields(record.shipment_info || FIELD_DEFAULTS);
    setPalletOverrides(record.pallet_overrides || {});
    setMode(record.mode || "single");

    // Migrate old flat splits format ({ itemNumber: qty }) to per-PO nested.
    const loadedSplits = record.splits || {};
    const poIds = (record.po_ids || []).map(String);
    const isNested = Object.keys(loadedSplits).length > 0 && Object.keys(loadedSplits).every(k => poIds.includes(k));
    setSplits(isNested ? loadedSplits : (poIds.length === 1 ? { [poIds[0]]: loadedSplits } : {}));

    const recContainers = record.containers;
    setContainers(
      recContainers && recContainers.length === 3
        ? recContainers.map(c => ({ number: c.number || "", seal: c.seal || "", pallets: c.pallets ?? "" }))
        : emptyContainers()
    );

    setSavedRecordsOpen(false);
    setSaveStatus("saved");
  };

  const handleNewSclp = () => {
    setCurrentSclpId(null);
    setSelectedPOs([]);
    setFields(FIELD_DEFAULTS);
    setPalletOverrides({});
    setMode("single");
    setSplits({});
    setContainers(emptyContainers());
    setSaveStatus("idle");
    setSavedRecordsOpen(false);
  };

  // ── Download / Print ────────────────────────────────────
  const handleDownloadSCLP = () => {
    if (selectedPOObjects.length === 0) return;
    const bodyHtml = buildSCLPHtml({ poList: selectedPOObjects, vendors, shipmentInfo: fields, palletOverrides, combinedTable: true });
    openSCLPWindow({ title: `SCLP_${selectedPOObjects.map(p => p.po_number).join("_")}`, bodyHtml });
  };

  const handleDownloadSCLPSplit = () => {
    const docs = getSplitDocs();
    const title = `SCLP_SPLIT_${selectedPOObjects.map(p => p.po_number).join("_")}`;
    const multiBody = docs.map(d =>
      `<div class="sclp-page">${buildSCLPHtml({
        poList: d.poList, vendors, shipmentInfo: d.shipmentInfo, palletOverrides,
        itemOverrides: d.itemOverrides, containerLabel: d.containerLabel,
        combinedTable: false, palletCount: d.palletCount,
      })}</div>`
    ).join("");
    openSCLPWindow({ title, bodyHtml: multiBody, multi: true });
  };

  const handlePrintLabels = () => {
    if (totalPalletsForSelected === 0) {
      alert("No pallets to print. Please set pallet counts for the selected POs.");
      return;
    }
    openPalletLabelsWindow({ selectedPOObjects, vendors, fields, getPalletCount });
  };

  // Build one combined doc per container (both POs' items merged).
  const getSplitDocs = () => {
    const cInfo = containers.map((c, i) => ({
      num: c.number || (i === 0 ? fields.containerNumber : ""),
      seal: c.seal || (i === 0 ? fields.sealNumber : ""),
      label: `Container ${i + 1}`,
      pallets: c.pallets,
    }));

    const buckets = [[], [], []];
    selectedPOObjects.forEach(po => {
      buildContainerItems(po.items || [], splits[po.id] || {}).forEach((items, i) => {
        items.forEach(item => buckets[i].push({ ...item, po }));
      });
    });

    return cInfo
      .map((info, i) => ({ info, items: buckets[i] }))
      .filter(({ items }) => items.length > 0)
      .map(({ info, items }) => ({
        poList: selectedPOObjects,
        shipmentInfo: { ...fields, containerNumber: info.num, sealNumber: info.seal },
        itemOverrides: items,
        containerLabel: info.label,
        palletCount: info.pallets,
      }));
  };

  // Save button label/style
  const saveLabel = saveStatus === "saving" ? "Saving…"
    : saveStatus === "saved" ? "Saved"
    : saveStatus === "error" ? "Error – Retry"
    : currentSclpId ? "Update SCLP"
    : "Save SCLP";

  const saveBtnClass = saveStatus === "saved"
    ? "gap-1.5 bg-green-600 hover:bg-green-700 text-white border-0"
    : saveStatus === "error"
    ? "gap-1.5 bg-red-500 hover:bg-red-600 text-white border-0"
    : "gap-1.5";

  const currentRecord = savedSclps.find(s => s.id === currentSclpId);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* HEADER */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex-1">Security Container Load Plan (SCLP)</h1>

        <div className="flex gap-2 items-center flex-wrap">
          <SavedSclpBrowser
            savedSclps={savedSclps}
            currentSclpId={currentSclpId}
            open={savedRecordsOpen}
            onToggle={() => setSavedRecordsOpen(o => !o)}
            onLoad={handleLoadSclp}
            onNew={handleNewSclp}
          />

          {selectedPOObjects.length > 0 && (
            <Button
              size="sm"
              variant={saveStatus === "saved" || saveStatus === "error" ? "default" : "outline"}
              onClick={handleSaveSclp}
              disabled={saveStatus === "saving"}
              className={saveBtnClass}
            >
              {saveStatus === "saved" ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {saveLabel}
            </Button>
          )}

          {selectedPOObjects.length > 0 && (
            <>
              <div className="w-px h-5 bg-gray-200" />

              <Button
                size="sm"
                variant="outline"
                onClick={mode === "split" ? handleDownloadSCLPSplit : handleDownloadSCLP}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download SCLP
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={handlePrintLabels}
                className="gap-1.5 border-amber-400 text-amber-700 hover:bg-amber-50"
              >
                <Tag className="w-3.5 h-3.5" />
                Pallet Labels
                {totalPalletsForSelected > 0 && (
                  <span className="ml-1 bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5 text-xs font-semibold">
                    {totalPalletsForSelected}
                  </span>
                )}
              </Button>

              <div className="w-px h-5 bg-gray-200" />

              <Button size="sm" variant={mode === "single" ? "default" : "outline"} onClick={() => setMode("single")} className="gap-1.5">
                <Square className="w-3.5 h-3.5" /> Single
              </Button>
              <Button size="sm" variant={mode === "split" ? "default" : "outline"} onClick={() => setMode("split")} className="gap-1.5">
                <SplitSquareHorizontal className="w-3.5 h-3.5" /> Split
              </Button>
            </>
          )}
        </div>
      </div>

      {/* PO selector — grouped by date */}
      <div className="bg-white border-b px-6 py-3 no-print">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600">Select POs</span>
          <span className="text-xs text-gray-400">{selectedPOs.length} selected</span>
        </div>
        <POGroupedSelector
          pos={pos}
          selectedIds={selectedPOs}
          onToggle={togglePO}
          onToggleGroup={(ids, allSelected) =>
            setSelectedPOs(prev =>
              allSelected ? prev.filter(x => !ids.includes(x)) : [...new Set([...prev, ...ids])]
            )
          }
          mode="multi"
        />
      </div>

      {/* BODY */}
      <div className="p-6 max-w-5xl mx-auto">

        {selectedPOObjects.length === 0 && (
          <div className="text-center py-12 text-gray-400">Select one or more POs to generate SCLP.</div>
        )}

        {vendorConflict && (
          <div className="mb-4 text-red-600 text-sm font-medium">⚠ Warning: Selected POs have different vendors.</div>
        )}

        {currentSclpId && (
          <div className="mb-4 flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            <Edit2 className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-blue-800">
              Editing saved SCLP: <strong>{fields.apllBookingNumber}</strong>
            </span>
            <button onClick={handleNewSclp} className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium underline">
              Start new
            </button>
          </div>
        )}

        {/* SHIPMENT DETAILS FORM */}
        {selectedPOObjects.length > 0 && (
          <div className="bg-white border rounded-xl mb-6 no-print">
            <button
              className="w-full flex items-center justify-between px-5 py-3 font-semibold text-sm"
              onClick={() => setFormOpen(o => !o)}
            >
              <span>Shipment Details</span>
              {formOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {formOpen && (
              <div className="px-5 pb-5 border-t">
                <div className="grid grid-cols-2 gap-4 mt-4">

                  <div>
                    <Label className="text-xs">Load Type</Label>
                    <Select value={fields.loadType} onValueChange={v => setField("loadType", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FCL – Full Container Load">FCL – Full Container Load</SelectItem>
                        <SelectItem value="LCL – Less than Container Load">LCL – Less than Container Load</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Container Size</Label>
                    <Select value={fields.containerSize} onValueChange={v => setField("containerSize", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20' DC (Dry Container)">20' DC (Dry Container)</SelectItem>
                        <SelectItem value="40' DC (Dry Container)">40' DC (Dry Container)</SelectItem>
                        <SelectItem value="40' HC (High Cube)">40' HC (High Cube)</SelectItem>
                        <SelectItem value="45' HC (High Cube)">45' HC (High Cube)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Container Number</Label>
                    <Input placeholder="e.g. CSNU1234567" value={fields.containerNumber} onChange={e => setField("containerNumber", e.target.value)} />
                  </div>

                  <div>
                    <Label className="text-xs">Seal Number</Label>
                    <Input placeholder="e.g. SL-9876543" value={fields.sealNumber} onChange={e => setField("sealNumber", e.target.value)} />
                  </div>

                  <div className="col-span-2">
                    <Label className="text-xs flex items-center gap-1">
                      APLL Booking #
                      <span className="text-red-500">*</span>
                      <span className="text-gray-400 font-normal">(used as save key)</span>
                    </Label>
                    <Input
                      placeholder="e.g. APLL-20240001"
                      value={fields.apllBookingNumber}
                      onChange={e => setField("apllBookingNumber", e.target.value)}
                      className={!fields.apllBookingNumber ? "border-amber-300 focus:border-amber-500" : ""}
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Vessel Name</Label>
                    <Input placeholder="e.g. MSC AURORA" value={fields.vesselName} onChange={e => setField("vesselName", e.target.value)} />
                  </div>

                  <div>
                    <Label className="text-xs">Voyage #</Label>
                    <Input placeholder="e.g. V001E" value={fields.voyageNumber} onChange={e => setField("voyageNumber", e.target.value)} />
                  </div>

                  <div>
                    <Label className="text-xs">Port of Loading</Label>
                    <Input value={fields.portOfLoading} onChange={e => setField("portOfLoading", e.target.value)} />
                  </div>

                  <div>
                    <Label className="text-xs">Actual Delivery Date to Port</Label>
                    <Input type="date" value={fields.actualDeliveryDate} onChange={e => setField("actualDeliveryDate", e.target.value)} />
                  </div>

                </div>

                {/* Per-PO Pallets */}
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">Pallets per PO</p>
                    {(() => {
                      const maxPallets = getContainerMaxPallets();
                      const totalCases = selectedPOObjects.reduce((s, po) =>
                        s + (po.items || []).reduce((ss, item) => ss + (parseInt(item.num_cartons) || 0), 0), 0);
                      const minStd = totalCases > 0 ? Math.ceil(totalCases / CASES_PER_PALLET_STD) : 0;
                      const minMax = totalCases > 0 ? Math.ceil(totalCases / CASES_PER_PALLET_MAX) : 0;
                      const fitsAtStd = minStd <= maxPallets;
                      const fitsAtMax = minMax <= maxPallets;
                      const statusColor = fitsAtStd ? "text-green-600" : fitsAtMax ? "text-amber-600" : "text-red-500";
                      const statusText = fitsAtStd
                        ? `${minStd} pallets @ 112/plt ✓ fits ${maxPallets}-pallet container`
                        : fitsAtMax
                        ? `${minMax} pallets @ max 140/plt ✓ fits ${maxPallets}-pallet container`
                        : `${minMax} pallets needed — exceeds ${maxPallets}-pallet limit`;
                      return (
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <span className="text-xs text-gray-500">
                            {totalCases} cases →{" "}
                            <span className={`font-medium ${statusColor}`}>{statusText}</span>
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleAutoDistributePallets}
                            disabled={totalCases === 0}
                            className="gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                          >
                            ✨ Auto-distribute
                          </Button>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="grid gap-2">
                    {selectedPOObjects.map(po => (
                      <div key={po.id} className="flex items-center gap-3">
                        <span className="text-sm w-36 shrink-0">{formatPoNumber(po)}</span>
                        <Input
                          type="number" min={0} className="w-28" placeholder="Pallets"
                          value={getPallets(po)}
                          onChange={e => handlePalletChange(po.id, e.target.value)}
                        />
                        <Button size="sm" variant="outline" disabled={savingPallets[po.id]} onClick={() => savePallets(po)} className="gap-1.5">
                          <Save className="w-3.5 h-3.5" />
                          {savingPallets[po.id] ? "Saving…" : "Save"}
                        </Button>
                        {po.total_pallets && (
                          <span className="text-xs text-gray-400">Stored: {po.total_pallets}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {totalPalletsForSelected > 0 && (
                    <div className="mt-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-amber-900">
                          {totalPalletsForSelected} pallet label{totalPalletsForSelected !== 1 ? "s" : ""} ready
                        </p>
                        {selectedPOObjects.length > 1 && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            Sequential across {selectedPOObjects.length} POs:&nbsp;
                            {selectedPOObjects.map(po => `${formatPoNumber(po)} (${getPalletCount(po)})`).join(", ")}
                          </p>
                        )}
                      </div>
                      <Button size="sm" onClick={handlePrintLabels} className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white border-0">
                        <Printer className="w-3.5 h-3.5" />
                        Print / Download Labels
                      </Button>
                    </div>
                  )}
                </div>

                {/* Save prompt at bottom of form */}
                <div className="mt-5 pt-4 border-t flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    {currentSclpId
                      ? `Last saved: ${currentRecord?.updated_date ? format(new Date(currentRecord.updated_date), "MMM d, yyyy h:mm a") : "—"}`
                      : "This SCLP has not been saved yet."}
                  </p>
                  <Button
                    size="sm"
                    onClick={handleSaveSclp}
                    disabled={saveStatus === "saving"}
                    className={saveBtnClass}
                  >
                    {saveStatus === "saved" ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    {saveLabel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SINGLE MODE — React preview */}
        {mode === "single" && selectedPOObjects.length > 0 && (
          <PrintWrapper title={`SCLP_${selectedPOObjects.map(p => p.po_number).join("_")}`}>
            <SCLPDoc
              poList={selectedPOObjects}
              vendors={vendors}
              shipmentInfo={fields}
              palletOverrides={palletOverrides}
              combinedTable={true}
            />
          </PrintWrapper>
        )}

        {/* SPLIT MODE */}
        {mode === "split" && selectedPOObjects.length > 0 && (
          <>
            {selectedPOObjects.map(po => (
              <div key={po.id}>
                {selectedPOObjects.length > 1 && (
                  <div className="text-sm font-semibold text-amber-900 mb-1 mt-2 first:mt-0">
                    {formatPoNumber(po)}
                  </div>
                )}
                <SplitContainerBuilder
                  po={po}
                  splits={splits[po.id] || {}}
                  onChange={(newSplits) => setSplits(prev => ({ ...prev, [po.id]: newSplits }))}
                />
              </div>
            ))}

            <div className="bg-white border rounded-xl p-4 mb-6 no-print">
              <p className="text-sm font-semibold mb-3">Container, Seal & Pallets (Split)</p>
              <div className="grid grid-cols-3 gap-4">
                {containers.map((c, i) => (
                  <div key={i} className="contents">
                    <div><Label>{`Container ${i + 1} #`}</Label><Input value={c.number} onChange={e => setContainerField(i, "number", e.target.value)} /></div>
                    <div><Label>{`Seal ${i + 1} #`}</Label><Input value={c.seal} onChange={e => setContainerField(i, "seal", e.target.value)} /></div>
                    <div><Label>{`Pallets (C${i + 1})`}</Label><Input type="number" min={0} value={c.pallets} onChange={e => setContainerField(i, "pallets", e.target.value)} /></div>
                  </div>
                ))}
              </div>
            </div>

            <PrintWrapper title={`SCLP_SPLIT_${selectedPOObjects.map(p => p.po_number).join("_")}`}>
              {getSplitDocs().map((doc, i) => (
                <div key={i} className={i > 0 ? "mt-10" : ""}>
                  <SCLPDoc
                    poList={doc.poList}
                    vendors={vendors}
                    shipmentInfo={doc.shipmentInfo}
                    itemOverrides={doc.itemOverrides}
                    containerLabel={doc.containerLabel}
                    palletCount={doc.palletCount}
                    combinedTable={false}
                  />
                </div>
              ))}
            </PrintWrapper>
          </>
        )}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break-after { page-break-after: always; }
        }
      `}</style>
    </div>
  );
}