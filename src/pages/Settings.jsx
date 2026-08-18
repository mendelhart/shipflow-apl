import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { uploadFile } from "@/lib/aiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload, Save, LogOut, Palette, Building2, User, ImageIcon, Mail, Eye, EyeOff, Cpu } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyErrorMessage } from "@/lib/errors";

const TABS = [
  { id: "company", label: "Company Info", icon: Building2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "Gemini API", icon: Cpu },
  { id: "email", label: "Email", icon: Mail },
  { id: "account", label: "Account", icon: User },
];

const DEFAULT_SETTINGS = {
  company_name: "",
  company_tagline: "",
  company_email: "",
  company_phone: "",
  company_address: "",
  exporter_name: "Mendel Hart",
  exporter_title: "Business Development Director",
  customs_id: "785337692RM0003",
  logo_url: "",
  primary_color: "#2563eb",
  sidebar_color: "#1e293b",
  app_title: "TJX Europe Shipping Hub",
  show_logo_on_documents: false,
  white_label_mode: false,
  background_color: "#f3f4f6",
  card_background_color: "#ffffff",
  text_color: "#111827",
  secondary_text_color: "#6b7280",
  mailgun_api_key: "",
  mailgun_domain: "",
  mailgun_from_email: "",
  mailgun_from_name: "Shipping Hub",
  mailgun_bcc: "",
  invoice_email_to: "apinvoices@tjxcanada.ca",
  email_template_subject: "Invoices - POs: {{po_numbers}}",
  email_template_body: "Dear TJX Canada Accounts Payable,\n\nPlease find the following invoices attached:\n\n{{po_list}}\n\nThank you,\n{{company_name}}",
  apl_email_to: "Canada_Export@apllogistics.com",
  apl_email_template_subject: "Booking {{booking_number}} - Shipping Documents",
  apl_email_template_body: "Dear APL Logistics Canada Export Team,\n\nPlease find attached the following shipping documents for the referenced purchase orders:\n\n{{po_list}}\n\nBooking Number: {{booking_number}}\nTotal Pallets: {{total_pallets}}\nTotal Cartons: {{total_cartons}}\nDocuments included: {{documents}}\n\nThank you,\n{{company_name}}",
  tjx_europe_email_to: "TJXEuropeAP@tjx.com",
  tjx_europe_email_template_subject: "Commercial Invoice - POs: {{po_numbers}}",
  tjx_europe_email_template_body: "Dear TJX Europe Accounts Payable,\n\nPlease find the following commercial invoices attached:\n\n{{po_list}}\n\nThank you,\n{{company_name}}",
};

// Same 402/403 classification used across TjxCanada.jsx / Invoices.jsx /
// CommercialInvoice.jsx / CustomerDocs.jsx — gives a clear message instead
// of a raw error string when integration credits run out or a backend
// function isn't available on the current plan.

export default function Settings() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logoInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState("company");
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [settingsId, setSettingsId] = useState(null);
  const hydratedRef = useRef(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [saved, setSaved] = useState(false);
  const [user, setUser] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [testEmailStatus, setTestEmailStatus] = useState(null);

  const { data: settingsList = [] } = useQuery({
    queryKey: ["appsettings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    if (settingsList.length > 0) {
      const s = settingsList[0];
      setSettingsId(s.id);
      // Hydrate ONCE. `settingsList` is a new array identity on every fetch,
      // so this effect re-ran on each refetch — including the one triggered by
      // saving — and replaced whatever the user had typed in the meantime with
      // server values, silently and with no warning.
      if (!hydratedRef.current) {
        hydratedRef.current = true;
        setForm({ ...DEFAULT_SETTINGS, ...s });
      }
    }
  }, [settingsList]);

  const saveMutation = useMutation({
    mutationFn: (data) =>
      settingsId
        ? base44.entities.AppSettings.update(settingsId, data)
        : base44.entities.AppSettings.create(data),
    onSuccess: (result) => {
      if (!settingsId && result?.id) setSettingsId(result.id);
      // FIX: React Query v5's invalidateQueries takes a filters OBJECT, not
      // a bare array. The old `qc.invalidateQueries(["appsettings"])` call
      // doesn't reliably match this query's key in v5, so other pages
      // (TjxCanada, Invoices, CommercialInvoice, etc.) could keep showing
      // stale settings — templates, Mailgun config, colors — after a save,
      // until a hard refresh.
      qc.invalidateQueries({ queryKey: ["appsettings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const fv = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));

  const handleLogoUpload = async (file) => {
    if (!file) return;
    setLogoUploading(true);
    setLogoError("");
    try {
      const { file_url } = await uploadFile({ file });
      setForm((p) => ({ ...p, logo_url: file_url }));
    } catch (err) {
      // FIX: previously had no try/catch, so a failed upload (network
      // error, or the same 402 out-of-credits case seen elsewhere — file
      // uploads also draw from integration credits) left the button stuck
      // showing "Uploading..." indefinitely with no way to retry short of
      // reloading the page.
      setLogoError(friendlyErrorMessage(err, "Logo upload failed. Please try again."));
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogout = () => base44.auth.logout("/");

  const handleTestEmail = async () => {
    if (!testEmailAddress) return;
    setTestEmailStatus("sending");
    try {
      const resp = await base44.functions.invoke("sendInvoiceEmail", {
        to: testEmailAddress,
        subject: "Test Email from Shipping Hub",
        body: "This is a test email to confirm your Mailgun configuration is working correctly.\n\nIf you received this, email is set up!",
      });
      // The adapter returns the Edge Function body directly; there is no axios
      // `.data` wrapper, so this always read undefined and reported a
      // successful send as an error.
      setTestEmailStatus(resp?.success ? "sent" : "error: " + friendlyErrorMessage({ message: resp?.error }, "Unknown error"));
    } catch (err) {
      setTestEmailStatus("error: " + friendlyErrorMessage(err, "Unknown error"));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 no-print">
        <Link to="/Dashboard"><ArrowLeft className="w-5 h-5 text-gray-500" /></Link>
        <h1 className="text-xl font-bold text-gray-900 flex-1">Settings</h1>
        <Button
          size="sm"
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className={saved ? "bg-green-600 hover:bg-green-700" : ""}
        >
          {saveMutation.isPending ? "Saving..." : saved ? "✓ Saved" : <><Save className="w-3 h-3 mr-1" />Save</>}
        </Button>
      </div>

      <div className="max-w-3xl mx-auto p-6 flex gap-6">
        {/* Sidebar Tabs */}
        <div className="w-44 shrink-0 space-y-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 mt-4 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white rounded-xl border p-6 space-y-5">

          {/* Company Info */}
          {activeTab === "company" && (
            <>
              <h2 className="font-semibold text-gray-800 text-base">Company Information</h2>
              <p className="text-xs text-gray-500 -mt-3">Used on generated shipping documents.</p>

              <div>
                <Label className="text-xs">Company Logo</Label>
                <div className="mt-2 flex items-center gap-4">
                  <div className="w-24 h-16 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden">
                    {form.logo_url ? (
                      <img src={form.logo_url} alt="Logo" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-300" />
                    )}
                  </div>
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                    >
                      <Upload className="w-3 h-3 mr-1" />
                      {logoUploading ? "Uploading..." : "Upload Logo"}
                    </Button>
                    {form.logo_url && (
                      <button
                        onClick={() => setForm((p) => ({ ...p, logo_url: "" }))}
                        className="block text-xs text-gray-400 hover:text-red-500 mt-1"
                      >
                        Remove
                      </button>
                    )}
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleLogoUpload(e.target.files[0])}
                    />
                    {logoError && (
                      <p className="text-xs text-red-500 mt-1 max-w-xs">{logoError}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label className="text-xs">Company Name</Label>
                  <Input value={form.company_name} onChange={f("company_name")} placeholder="e.g. Maple Syrup Co." className="h-8 text-sm mt-1" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Tagline / Description</Label>
                  <Input value={form.company_tagline} onChange={f("company_tagline")} placeholder="e.g. Premium Canadian Syrups" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={form.company_email} onChange={f("company_email")} placeholder="info@company.com" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input value={form.company_phone} onChange={f("company_phone")} placeholder="+1 (514) 000-0000" className="h-8 text-sm mt-1" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Address</Label>
                  <textarea
                    value={form.company_address}
                    onChange={f("company_address")}
                    placeholder="123 Main St, Montreal, QC, Canada"
                    className="w-full border rounded-md p-2 text-sm mt-1 h-20 resize-none"
                  />
                </div>
              </div>

              <div className="border-t pt-6 mt-2">
                <h3 className="font-medium text-gray-700 text-sm mb-1">Signing Authority</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Used as the default name/title/signature on the UK Origin Declaration (Commercial Invoice) — each PO can still override this individually if a different person signs for it.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Exporter Name</Label>
                    <Input value={form.exporter_name} onChange={f("exporter_name")} placeholder="e.g. Mendel Hart" className="h-8 text-sm mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Exporter Title</Label>
                    <Input value={form.exporter_title} onChange={f("exporter_title")} placeholder="e.g. Business Development Director" className="h-8 text-sm mt-1" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Customs ID / EORI Number</Label>
                    <Input value={form.customs_id} onChange={f("customs_id")} placeholder="e.g. 785337692RM0003" className="h-8 text-sm mt-1" />
                    <p className="text-xs text-gray-400 mt-1">Shown on the UK Origin Declaration's customs identification line.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Appearance */}
          {activeTab === "appearance" && (
            <>
              <h2 className="font-semibold text-gray-800 text-base">Appearance</h2>
              <p className="text-xs text-gray-500 -mt-3">Customize the look of the app.</p>

              <div>
                <Label className="text-xs">App Title</Label>
                <Input value={form.app_title} onChange={f("app_title")} placeholder="TJX Europe Shipping Hub" className="h-8 text-sm mt-1" />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label className="text-xs">Primary Accent Color</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <input type="color" value={form.primary_color} onChange={f("primary_color")} className="w-10 h-10 rounded cursor-pointer border border-gray-200" />
                    <Input value={form.primary_color} onChange={f("primary_color")} className="h-8 text-sm font-mono w-28" maxLength={7} />
                  </div>
                  <div className="mt-3 rounded-lg p-3 text-white text-xs font-medium text-center" style={{ backgroundColor: form.primary_color }}>Preview Button</div>
                </div>
                <div>
                  <Label className="text-xs">Navigation / Header Color</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <input type="color" value={form.sidebar_color} onChange={f("sidebar_color")} className="w-10 h-10 rounded cursor-pointer border border-gray-200" />
                    <Input value={form.sidebar_color} onChange={f("sidebar_color")} className="h-8 text-sm font-mono w-28" maxLength={7} />
                  </div>
                  <div className="mt-3 rounded-lg p-3 text-white text-xs font-medium text-center" style={{ backgroundColor: form.sidebar_color }}>Preview Nav</div>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-medium text-gray-700 text-sm mb-4">White Label Colors</h3>
                <div className="space-y-4">
                  {[
                    { key: "background_color", label: "Background Color", def: "#f3f4f6" },
                    { key: "card_background_color", label: "Card/Panel Background", def: "#ffffff" },
                    { key: "text_color", label: "Text Color", def: "#111827" },
                    { key: "secondary_text_color", label: "Secondary Text Color", def: "#6b7280" },
                  ].map(({ key, label, def }) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <input type="color" value={form[key] || def} onChange={f(key)} className="w-10 h-10 rounded cursor-pointer border border-gray-200" />
                        <Input value={form[key] || def} onChange={f(key)} className="h-8 text-sm font-mono w-28" maxLength={7} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-medium text-gray-700 text-sm mb-3">White Label Options</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="show_logo" checked={form.show_logo_on_documents || false} onChange={(e) => fv("show_logo_on_documents")(e.target.checked)} className="rounded border-gray-300" />
                    <label htmlFor="show_logo" className="text-sm text-gray-700">Show logo on shipping documents</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="white_label" checked={form.white_label_mode || false} onChange={(e) => fv("white_label_mode")(e.target.checked)} className="rounded border-gray-300" />
                    <label htmlFor="white_label" className="text-sm text-gray-700">Hide TJX branding</label>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* AI Provider */}
          {activeTab === "ai" && (
            <>
              <h2 className="font-semibold text-gray-800 text-base">AI document parsing</h2>
              <p className="text-xs text-gray-500 -mt-3">
                Customer Documents, Commercial Invoice and TJX Canada use Google Gemini to read
                uploaded PDFs.
              </p>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs text-slate-700">
                  <span className="font-medium">The API key is now held on the server.</span>{" "}
                  It used to be stored in this browser, where any script on the page could read it
                  and it could not be rotated centrally. Requests now go through the{" "}
                  <code className="text-[11px] bg-white px-1 py-0.5 rounded border">llm</code>{" "}
                  Edge Function, which keeps the key server-side and rate-limits per user.
                </p>
                <p className="text-xs text-slate-600">
                  To set or rotate it:
                </p>
                <pre className="text-[11px] bg-white border rounded p-2 overflow-x-auto">supabase secrets set GEMINI_API_KEY=...</pre>
                <p className="text-xs text-amber-700">
                  If a key was previously saved here, treat it as compromised and rotate it.
                </p>
              </div>
            </>
          )}

          {/* Email */}
          {activeTab === "email" && (
            <>
              <h2 className="font-semibold text-gray-800 text-base">Email Configuration</h2>
              <p className="text-xs text-gray-500 -mt-3">
                Uses <a href="https://mailgun.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Mailgun</a> to send emails.
              </p>

              {/* Mailgun Credentials */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                <h3 className="font-medium text-gray-700 text-sm">Mailgun Credentials</h3>
                <div>
                  <Label className="text-xs">API Key</Label>
                  <div className="relative mt-1">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={form.mailgun_api_key}
                      onChange={f("mailgun_api_key")}
                      placeholder="key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="h-8 text-sm pr-9"
                    />
                    <button type="button" onClick={() => setShowApiKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Find this in your <a href="https://app.mailgun.com/mg/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-500">Mailgun dashboard</a> under API Keys.</p>
                </div>
                <div>
                  <Label className="text-xs">Sending Domain</Label>
                  <Input value={form.mailgun_domain} onChange={f("mailgun_domain")} placeholder="mg.yourdomain.com" className="h-8 text-sm mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">From Email</Label>
                    <Input value={form.mailgun_from_email} onChange={f("mailgun_from_email")} placeholder="invoices@yourdomain.com" className="h-8 text-sm mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">From Name</Label>
                    <Input value={form.mailgun_from_name} onChange={f("mailgun_from_name")} placeholder="Shipping Hub" className="h-8 text-sm mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Global BCC (optional)</Label>
                  <Input value={form.mailgun_bcc} onChange={f("mailgun_bcc")} placeholder="you@company.com" className="h-8 text-sm mt-1" />
                  <p className="text-xs text-gray-400 mt-1">Added as BCC on every outgoing email.</p>
                </div>
              </div>

              {/* Task 1: TJX Canada Invoices */}
              <div className="border rounded-lg p-4 space-y-4">
                <div>
                  <h3 className="font-medium text-gray-800 text-sm">📄 TJX Canada — Invoice Emails</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Sent from the TJX Canada Invoice Processor.</p>
                </div>
                <div>
                  <Label className="text-xs">Recipient Address</Label>
                  <Input value={form.invoice_email_to} onChange={f("invoice_email_to")} placeholder="apinvoices@tjxcanada.ca" className="h-8 text-sm mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">From Email (override)</Label>
                    <Input value={form.invoice_from_email || ""} onChange={f("invoice_from_email")} placeholder="Global default" className="h-8 text-sm mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">From Name (override)</Label>
                    <Input value={form.invoice_from_name || ""} onChange={f("invoice_from_name")} placeholder="Global default" className="h-8 text-sm mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={form.email_template_subject} onChange={f("email_template_subject")} placeholder="Invoices - POs: {{po_numbers}}" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Body</Label>
                  <textarea
                    value={form.email_template_body}
                    onChange={f("email_template_body")}
                    rows={6}
                    className="w-full border rounded-md p-2 text-sm mt-1 resize-none font-mono"
                    placeholder="Dear TJX Canada Accounts Payable, ..."
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Placeholders: <code className="bg-gray-100 px-1 rounded">{"{{po_numbers}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{po_list}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{company_name}}"}</code>
                </p>
              </div>

              {/* Task 2: APL Logistics */}
              <div className="border rounded-lg p-4 space-y-4">
                <div>
                  <h3 className="font-medium text-gray-800 text-sm">🚢 APL Logistics — Shipping Documents</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Sent when submitting documents to APL from the Purchase Orders page.</p>
                </div>
                <div>
                  <Label className="text-xs">Recipient Address</Label>
                  <Input value={form.apl_email_to} onChange={f("apl_email_to")} placeholder="Canada_Export@apllogistics.com" className="h-8 text-sm mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">From Email (override)</Label>
                    <Input value={form.apl_from_email || ""} onChange={f("apl_from_email")} placeholder="Global default" className="h-8 text-sm mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">From Name (override)</Label>
                    <Input value={form.apl_from_name || ""} onChange={f("apl_from_name")} placeholder="Global default" className="h-8 text-sm mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={form.apl_email_template_subject} onChange={f("apl_email_template_subject")} placeholder="Booking {{booking_number}} - Shipping Documents" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Body</Label>
                  <textarea
                    value={form.apl_email_template_body}
                    onChange={f("apl_email_template_body")}
                    rows={7}
                    className="w-full border rounded-md p-2 text-sm mt-1 resize-none font-mono"
                    placeholder="Dear APL Logistics, ..."
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Placeholders: <code className="bg-gray-100 px-1 rounded">{"{{booking_number}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{po_numbers}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{po_list}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{documents}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{total_pallets}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{total_cartons}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{company_name}}"}</code>
                </p>
              </div>

              {/* Task 3: TJX Europe */}
              <div className="border rounded-lg p-4 space-y-4">
                <div>
                  <h3 className="font-medium text-gray-800 text-sm">🇬🇧 TJX Europe — Commercial Invoices</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Sent when emailing commercial invoices to TJX Europe AP.</p>
                </div>
                <div>
                  <Label className="text-xs">Recipient Address</Label>
                  <Input value={form.tjx_europe_email_to} onChange={f("tjx_europe_email_to")} placeholder="TJXEuropeAP@tjx.com" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input value={form.tjx_europe_email_template_subject} onChange={f("tjx_europe_email_template_subject")} placeholder="Commercial Invoice - POs: {{po_numbers}}" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Body</Label>
                  <textarea
                    value={form.tjx_europe_email_template_body}
                    onChange={f("tjx_europe_email_template_body")}
                    rows={6}
                    className="w-full border rounded-md p-2 text-sm mt-1 resize-none font-mono"
                    placeholder="Dear TJX Europe Accounts Payable, ..."
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Placeholders: <code className="bg-gray-100 px-1 rounded">{"{{po_numbers}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{po_list}}"}</code> <code className="bg-gray-100 px-1 rounded">{"{{company_name}}"}</code>
                </p>
              </div>

              {/* Test Email */}
              <div className="border-t pt-5">
                <h3 className="font-medium text-gray-700 text-sm mb-3">Send Test Email</h3>
                <div className="flex gap-2">
                  <Input value={testEmailAddress} onChange={e => setTestEmailAddress(e.target.value)} placeholder="your@email.com" className="h-8 text-sm" />
                  <Button size="sm" variant="outline" onClick={handleTestEmail} disabled={testEmailStatus === "sending" || !testEmailAddress}>
                    {testEmailStatus === "sending" ? "Sending..." : "Send Test"}
                  </Button>
                </div>
                {testEmailStatus && testEmailStatus !== "sending" && (
                  <p className={`text-xs mt-2 ${testEmailStatus === "sent" ? "text-green-600" : "text-red-500"}`}>
                    {testEmailStatus === "sent" ? "✓ Test email sent successfully!" : testEmailStatus}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-2">Save settings before sending a test.</p>
              </div>
            </>
          )}

          {/* Account */}
          {activeTab === "account" && (
            <>
              <h2 className="font-semibold text-gray-800 text-base">Account</h2>
              {user && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                      {(user.full_name || user.email || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{user.full_name || "—"}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 pt-1">
                    Role: <span className="font-medium capitalize">{user.role || "user"}</span>
                  </div>
                </div>
              )}
              <div className="pt-2">
                <Button variant="destructive" size="sm" onClick={handleLogout} className="gap-2">
                  <LogOut className="w-4 h-4" /> Log Out
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}