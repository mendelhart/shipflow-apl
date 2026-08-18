# ShipFlow APL — senior code review

18 August 2026 · reviewed at commit `3134b52`, fixes landed in `37bb852`

**Scope:** the migrated ShipFlow APL repo — 17,500 LOC of React across 132
files, the Supabase schema, and four Deno Edge Functions. Next Level – Ship
Tool was not reviewed; it shares the adapter, so several findings will apply
there too.

**Method:** six independent reviews (security, data integrity, React
correctness, Edge Functions, performance, testing/architecture), then I
re-read the cited code for every P0/P1 myself. Nothing below was implemented on
an unverified claim. Where I could not verify something, it says so.

---

## Executive summary

**The app as migrated could not save data at all, and its database was open to
anyone on the internet who could receive an email.** Both are fixed.

Three separate defects meant every write path failed 100% of the time:

1. Base44 accepted `""` as "unset" for any type. Postgres rejects it for `date`
   and numeric columns and fails the **entire row**. `EMPTY_PO` ships three
   empty date strings, so no purchase order could ever be created.
2. Four columns the app writes (`exporter_name`, `exporter_title`, `customs_id`,
   `commonName`) never existed in the schema. PostgREST rejects the whole row
   with `PGRST204`, so the Settings page and every customer-invoice save failed.
3. Three of the four Edge Functions never awaited `createClientFromRequest`, so
   `base44.auth` was `undefined` and every invocation returned a 500. Email
   sending, PDF parsing and invoice splitting were entirely dead.

None of these would have appeared in a smoke test that only *reads* data — which
is exactly what the verification checklist I gave you would have done. You would
have found them on your first attempt to save a purchase order, in production.

On security, the schema I generated during the migration was the problem. Every
table carried `using (true)` for any authenticated role, and Supabase email
sign-in creates an account for **any** address by default. Anyone could sign up
and then read, modify or delete your entire purchase-order, product and customer
dataset over the REST API without ever loading the app. Compounding it, a user
could set their own `role` to `admin`, and your live Mailgun key sat in a
database row every authenticated user could read — enough to send invoices "from"
Capital Nutrition to TJX and APL.

**Verdict: it was not safe to put into production before this pass. It is now
safe to pilot** — with the caveats in "What I did not fix" below, and on the
understanding that the email and AI paths have never once executed successfully
and are therefore untested rather than proven.

---

## What changed, by severity

### P0 — fixed

| # | Area | Problem | Where |
|---|---|---|---|
| 1 | Data | `""` into `date`/`numeric` fails the whole row — no PO, product or vendor could be saved | `POForm.jsx:15`, `Products.jsx:32`, `Vendors.jsx:59` → fixed centrally in the adapter |
| 2 | Data | 4 columns written by the app don't exist; Settings and customer invoices never saved | `schema.sql` → migration 002 |
| 3 | Reliability | 3 of 4 Edge Functions dead (`createClientFromRequest` not awaited) | `sendInvoiceEmail:40`, `processInvoicePdf:80`, `splitInvoicePdf:29` |
| 4 | Security | Any user could set their own `role='admin'` | `schema.sql:32` |
| 5 | Security | Every table world-readable/writable to any authenticated identity; open signup | `schema.sql` ×8 tables |
| 6 | Security | Live Mailgun key readable — and writable — by every authenticated user | `schema.sql:83`, `sendInvoiceEmail:51` |
| 7 | Data | `delete()` reported success when nothing was deleted | `base44Client.js:210` |

### P1 — fixed

| # | Area | Problem |
|---|---|---|
| 8 | Security | Gemini key in `localStorage`; the `llm` function built to fix it had **zero call sites** |
| 9 | Security | SSRF in `llm` and `sendInvoiceEmail` — server fetched client URLs and relayed the response (transcribed by the model, or emailed as an attachment) |
| 10 | Security | `sendInvoiceEmail` accepted arbitrary `to`/`from_email` and unescaped HTML — an authenticated, DKIM-signed phishing relay |
| 11 | Data | Offset paging ordered only by `created_date`; ties are routine, so rows could appear on two pages or on none |
| 12 | Reliability | A 2-second network blip → permanent "You are not registered" screen, no retry, rest of session |
| 13 | Reliability | Stale closure made the `TOKEN_REFRESHED` guard never fire; every hourly refresh refetched, and a failure ejected the user mid-edit |
| 14 | Reliability | `getSession()` rejection → infinite spinner, no recovery |
| 15 | Reliability | No error boundary: a deploy 404s the old lazy chunks and blanks the app |
| 16 | Observability | Zero `onError` on all 9 mutations — failed saves were completely silent |
| 17 | Correctness | Successful test email always reported `error: Unknown error` |
| 18 | Correctness | `processFile` called inside a `setState` updater → every invoice uploaded and AI-billed **twice**, then flagged a duplicate of itself |
| 19 | Correctness | Partial multi-batch send reported total failure → retry re-sent invoices customers already had |
| 20 | Correctness | `splitInvoicePdf` trusted model page ranges; an inverted range emailed a **zero-page PDF** as a customer's invoice |
| 21 | Data | Editing a saved customer invoice always created a second copy |
| 22 | Data | Pallet count silently NULLed by `parseInt` NaN, with no `catch` at all |
| 23 | UX | Single-click delete with no confirmation on a hover-revealed trash icon |
| 24 | Maintainability | `STATUS_ORDER`/`bumpStatus` in 5 copies + a SQL constraint; `friendlyErrorMessage` in 6 copies, all dead code |

### P2 — fixed

Query-key casing (`appSettings` vs `appsettings`) left two pages on stale
settings; react-query v5 `invalidateQueries(["x"])` array form invalidated the
entire cache on every vendor edit; `staleTime: 0` refetched every whole table on
every navigation; `$ne`/`$nin` excluded NULLs (Mongo matches them); `$contains`
didn't escape `%`, so searching "50%" matched everything; a `Date` value in a
filter applied **no condition at all** and returned every row; `limit: 0` meant
unlimited; PDF button could hang disabled forever; the APL dialog could be
dismissed mid-send, destroying the confirmation while the send continued;
`Login.jsx` built `https://hosthttps://host/Page` from an absolute `next`;
Edge Functions leaked raw Postgres and provider text; CORS emitted an empty
`Access-Control-Allow-Origin` that blocks your own app; the LLM retry read only
`parts[0]` and ignored truncation and safety blocks.

---

## Server-side additions

Client-side rules can't hold when two people work at once, so these moved into
the database:

- **Status monotonicity trigger.** `bumpStatus` compared against the row the
  *browser* loaded. Two users editing concurrently could revert a `shipped` PO
  to `draft` and erase the other's container totals. The trigger now keeps the
  further-advanced status regardless of what any client sends.
- **Append-only `activity_log`** with automatic PO status history, plus
  `updated_by` stamping. Previously nothing recorded who changed a PO, and
  invoicing TJX Europe or APL wrote no record at all — "did we invoice PO
  50 813584, when, and to whom?" was unanswerable from the database.
- **Business-key uniqueness** on `(po_prefix, po_number)`, `product.item_number`
  and `sclp.booking_number`.

---

## Two things in your live data

**Duplicate UPC codes — not constrained, deliberately.** Two pairs of different
products share a barcode:

- `1002` Sugar Free Maple **Bacon** Syrup and `1003` Sugar Free Maple
  **Strawberry** Syrup both carry `628693015028`
- `1099G` Gold Pump and `1099P` Purple Pump both carry `628693015998`

`CustomerDocs` builds its lookup by UPC on a last-write-wins basis, so AI import
enriches line items with whichever of the pair the (previously unstable) sort
surfaced last. **This is a data error to correct, not a code bug** — I left the
column unconstrained so your saves keep working, and added a non-unique index.

**Four apparent duplicate PO numbers are legitimate** — all are `50`/`55` prefix
pairs, which is why the constraint is composite.

---

## What I did **not** fix, and why

**Carton labels will still crash the tab on large POs.** `Labels.jsx` renders one
DOM label per carton, each containing a hand-rolled ~60-rect UPC barcode. Your
live POs reach **2,128 cartons** — roughly 210,000 DOM nodes, then 2,128
sequential `html2canvas` rasterisations held as images in one PDF. I added a
confirmation above 300 labels, a progress counter, JPEG at scale 2 instead of
lossless PNG at scale 3, and canvas release between pages. That reduces the
crash window; it does not remove it. **The real fix is to draw the label
vectorially with jsPDF** (it's text and rectangles — `emailDocs.js` already does
this for invoices). I did not attempt that unattended: label output is what goes
on your physical cartons, and silently changing it would be worse than the bug.

**Whole-table reads.** `PurchaseOrder.list()` with no limit runs on six pages and
pulls every row including the `items` jsonb — about 4.3 KB per PO. Fine at 20;
at 2,000 POs it's ~8.5 MB per fetch. `staleTime` now stops the refetch-on-every-
navigation, which is most of the pain, but the fix is date-windowed queries and
column projection. Not urgent at your volume.

**The remaining god components.** `TjxCanada.jsx` is 1,127 lines and is
simultaneously a page, a PDF text extractor, an LLM client, an email batcher, a
MIME encoder and an archive writer. The `.eml` pipeline exists in **three**
near-identical copies whose size constants have already drifted (23 MB
client-side vs 37 MB in the Edge Function). This is the biggest three-year
maintenance liability in the codebase. It needs a planned refactor, not an
unattended one.

**Unverifiable from code:** whether your Supabase project has open signup at the
dashboard level (I closed it at the data layer regardless), whether the
`uploads` bucket was created public, and whether Mailgun/Gemini keys have
actually been rotated.

---

## Architecture assessment

**The adapter was the right call and should now be frozen.** 363 lines avoided
rewriting ~2,300 call sites, made the migration reversible, and is the
best-written file in the repo. But it preserves a vendor's weakest ideas —
positional `list(sort, limit)`, Mongo-ish operators over PostgREST, `select('*')`
always, no joins, no RPC, no transactions — and every new feature written against
it adds to the pile that must eventually migrate. Treat it as a strangler
boundary: new code against Supabase directly, old code migrated opportunistically.

**Testing.** The previous suite read the adapter as *text*, regex-replaced
identifiers and `eval`'d it — running non-strict code that wasn't what shipped,
and unable to reach anything touching the client. It could have passed while
production threw. The pure core is now `adapterCore.js`, imported normally.
**25 tests, all real regressions**, including one that asserts the SQL status
list and the JS array still agree.

---

## Recommended sequence from here

**Before anyone uses it**

1. Rotate the Mailgun and Gemini keys. Both were readable; assume compromised.
2. Deploy the Edge Functions — they have never once run successfully, so treat
   email and AI as unproven, not working.
3. Set `ALLOWED_ORIGINS` on the functions to your Pages URL, or every browser
   call is rejected.
4. Sign in once so your admin profile is created, then verify a **save**, not
   just a read: create a PO, save Settings, save a customer invoice.

**Next**

5. Fix the two duplicate UPC pairs in Products.
6. Re-host the logo off `base44.app`.
7. Confirm Supabase Auth signup restrictions at the dashboard level.

**Soon**

8. Vector carton labels.
9. Date-windowed PO queries.

**Technical debt**

10. Break up `TjxCanada.jsx`; collapse the three `.eml` pipelines into one.
11. Real error tracking — there is none, and `console.error` is not observability.
