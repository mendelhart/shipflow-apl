# Round 2 — everything deferred, plus your two reports

18 August 2026 · commit `c4216fc`

`npm run check` green: lint clean, **43 tests**, production build succeeds.

---

## 1. Carton labels — the item I deliberately held back

I said last round that I wouldn't silently change what prints on your physical
cartons while you were out. With the go-ahead, it's done properly.

**Before:** one DOM label per carton, then `html2canvas` over each one, each
retained as a lossless bitmap in a single PDF. Your live POs reach **2,128
cartons** — roughly 210,000 DOM nodes. It crashed the tab.

**Now:** the label is drawn directly as vectors. It's text and rectangles, so
this was always the right shape for it.

| | Before | After |
|---|---|---|
| 2,128 labels | crashed | **1.4 s, 10 MB** |
| Text & barcode | screenshot | vector, sharper |

Three things I did to keep the output trustworthy:

- **One renderer.** Print and PDF both build the same document. Previously
  Print used the DOM and PDF rasterised it, so the two could drift. The page
  now shows one sample per item and says so.
- **Shared UPC module.** The check-digit correction and the scanner quiet-zone
  logic already in your code are now in one place used by both the preview and
  the print path — a barcode that differs between the two scans as the wrong
  product at the receiving warehouse.
- **Tests.** One page per carton, 4×6 page size, 2,000-label build, the
  11-digit-UPC case, and the corrupt-check-digit case.

**Worth checking before a real run:** print one page and compare against a
label from the old system. The data and barcode are identical by construction;
the typography is Helvetica rather than a screenshot of Arial.

---

## 2. "Not all products get saved"

You were right, and it was three separate bugs — all the same shape.

**Bulk Edit was the main one.** It ran `Promise.all` over every selected
product with no `catch`. A single rejection threw out of the handler, so the
dialog hung on "Saving…" — and, exactly as you described, **some products were
written and some weren't, with nothing telling you which**. It also fired 74
simultaneous requests, and `parseFloat("abc")` → `NaN` → `null` would have
*wiped* a field across every selected product.

Now: five at a time, every result collected, and a plain statement of what
failed — with the dialog staying open so you can see it.

**Both AI enrichment loops** (Products toolbar and the Food Checklist panel)
aborted the entire batch on the first failure. Every product queued behind it
was silently left unenriched, and the count of what *had* saved was thrown away
with the error. Each product is now isolated.

**Customer Docs catalog auto-create** aborted on the first duplicate — and then
reported *"Failed to extract data from this document. Please try again."* So a
document that parsed perfectly sent you back to re-upload and re-pay for it.
Catalog writes are now a side effect that can never fail the extraction.

## "Not searchable or sortable"

The cause is a bit absurd: there are **two** product screens. `/Products` has
search, sort and a food filter — and nothing in the app links to it. The
catalog you actually use, inside **Vendors**, had neither.

I extracted one `useProductSearch` hook and wired it into the Vendors catalog:
search across item #, description, UPC, style and HS code; a food/non-food
filter; sortable column headers. Details worth knowing:

- **Natural ordering**, so `1002 < 1010 < 1099G` instead of string order.
- **Blank prices sort last**, in both directions, rather than pretending to be 0.
- **Select-all applies to what's filtered**, not the whole catalog — otherwise
  a bulk edit silently hits products you can't see.
- It sorts a *copy*; the previous pattern would have mutated react-query's
  cached array that other pages read.

The two product screens remain a real duplication — two forms, two save paths,
already drifting. Worth collapsing, but not something to do unattended.

---

## 3. SCLP layout

- **Split mode showed all three containers, always.** It now starts at two with
  an explicit "Add a third container". Removing one **clears its values**, so a
  hidden third container can't keep contributing stale numbers to the saved
  record.
- **Container/seal fields are hidden in split mode**, where the per-container
  block supersedes them — having both invited contradictory entries.
- Each container is its own card, with a running total of allocated pallets.
- **Auto-load no longer overwrites your work.** Ticking one more PO could make
  the selection match an SCLP saved weeks ago, and every container, seal,
  vessel and voyage field you'd just typed was replaced with no prompt and no
  undo. It now asks.

---

## 4. The rest of the deferred list

| Fixed | Was |
|---|---|
| Settings form | Re-hydrated from the server on every refetch, overwriting what you were typing |
| Commercial Invoice auto-save | Failed silently while the UI promised "saved automatically" |
| Date formatting | `format()` throws on an invalid date; one bad row blanked a whole page |
| Booking # save | Reported false failures by re-reading a stale cache after a failed refetch |
| Deep-linked PO | Re-opened the editor on every background refetch |
| `wrapBase64` | Threw on empty input (`String.match` returns `null`, not `[]`) |
| Pallet-label window | Interpolated AI-extracted values into `document.write` unescaped |
| Blob URLs | Per-file PDFs leaked for the life of the tab |
| Failed queries | Rendered as empty states — "No invoices sent yet" when the fetch had failed |
| `ProtectedRoute` | Dead component referencing context fields that don't exist; deleted |

One correction on my own work: I started adding blob-URL revokes to the zip and
`.eml` download paths, then found they already had them. Reverted rather than
leaving a redundant change in.

---

## Still not done, deliberately

**The two product screens** should become one. **`TjxCanada.jsx`** is still
1,127 lines doing six jobs, and the `.eml` pipeline still exists in three
near-identical copies with **already-drifted size limits** (23 MB client-side
vs 37 MB in the Edge Function — a file between the two passes the client check
and is rejected by the server). That's the biggest remaining maintenance
liability, and it needs a planned refactor with you available to test.

**Date-windowed PO queries** need a product decision on the window.

---

## Unchanged from last round

Before anyone uses this: **rotate the Mailgun and Gemini keys**, deploy the
Edge Functions (they have never once executed successfully), set
`ALLOWED_ORIGINS`, and test a **save** rather than a read.
