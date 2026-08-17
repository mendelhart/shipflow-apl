# ShipFlow APL — go-live runbook

Everything below is free tier. Roughly 20 minutes end to end.

## 0. Before you start

Rotate these two credentials. Both were sitting in places any signed-in user
could read, so treat them as compromised:

- **Mailgun API key** — was stored in the `AppSettings` record in Base44.
  Rotate at Mailgun → Sending → API keys.
- **Gemini API key** — was in browser `localStorage`.
  Rotate at aistudio.google.com → Get API key.

Do not paste the new keys into chat or into any `VITE_` variable. They go into
Supabase Edge Function secrets in step 3.

## 1. Database

Supabase → SQL Editor → run in this order:

1. `supabase/schema.sql` — 9 tables, RLS, indexes, triggers, `profiles`
2. `supabase/seed.sql` — your live Base44 data (101 rows)
3. `supabase/storage-policies.sql` — locks the bucket to signed-in users

Verify:

```sql
select table_name, (xpath('/row/c/text()',
  query_to_xml(format('select count(*) c from %I', table_name), false, true, '')))[1]::text::int as rows
from information_schema.tables where table_schema = 'public' order by table_name;
```

Expect: `product` 74, `purchase_order` 20, `sclp` 2, `customer_invoice` 2,
`vendor` 1, `app_settings` 1, `inbound_shipment` 1.

## 2. Auth and storage

- Authentication → Providers → enable **Google** and **Email** (magic link).
- Authentication → URL Configuration → add your Pages URL to redirect URLs.
- Storage → create a private bucket named `uploads` (invoice PDFs from this app).
- Sign in once yourself, then promote your account:

```sql
update profiles set role = 'admin' where email = 'mhart@capitalnutrition.ca';
```

## 3. Edge Functions

```bash
supabase link --project-ref <project-ref>
supabase secrets set \
  GEMINI_API_KEY=<new key> \
  MAILGUN_API_KEY=<new key> \
  MAILGUN_DOMAIN=mg.capitalnutrition.ca \
  ALLOWED_ORIGINS=https://shipflow-apl.pages.dev
supabase functions deploy llm sendInvoiceEmail processInvoicePdf splitInvoicePdf
```

## 4. Cloudflare Pages

Connect the repo. Build `npm run build`, output `dist`. Environment variables:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_BUCKET=uploads`.

## 5. Verify before cutting over

Run the old and new side by side and check:

- [ ] Sign in works; your role shows as admin
- [ ] Products list shows all 74 (this is the pagination fix — count it)
- [ ] Open a purchase order, edit it, confirm the change persists
- [ ] Generate a commercial invoice PDF
- [ ] Send one test invoice email to yourself
- [ ] Upload a document and reopen it from its stored URL

Only then point anyone at the new URL.

## Notes

- `TjxCanadaInvoiceLog` never existed as a Base44 entity — the API returns 404
  for it. Every archive write in `TjxCanada.jsx` was failing and being
  swallowed by a `catch`. A table now exists, so that history will start
  recording for the first time. There is no past data to import.
- Six SCLP fields in your data (`c1_number`, `c1_seal`, `c2_number`, `c2_seal`,
  `c3_number`, `c3_seal`) are from an older data model, aren't declared in the
  entity, and aren't read anywhere in the code. They were not carried over.

## One asset still lives on Base44

`AppSettings.logo_url` points at `base44.app/api/apps/.../logop.png`. That URL
stops working when the Base44 app goes away, and the logo appears on every
invoice and outgoing email.

Fix it during step 2: download the current logo, upload it to the `uploads`
bucket, then:

```sql
update app_settings set logo_url = '<new supabase public url>';
```

Nothing else in the exported data references a Base44 URL — I checked every
field of every row.
