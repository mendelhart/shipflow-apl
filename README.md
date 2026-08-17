# ShipFlow APL

APL-compliant commercial invoices, packing lists, carton/pallet labels and food
compliance checklists.

Migrated off Base44. Runs on **Cloudflare Pages + Supabase**, both free tier.

---

## Stack

| Concern | Was (Base44) | Now |
|---|---|---|
| Hosting | Base44 preview/publish | Cloudflare Pages (free, commercial use allowed) |
| Database | Base44 entities | Supabase Postgres + Row Level Security |
| Auth | Base44 hosted login | Supabase Auth (Google OAuth + magic link) |
| File storage | `Core.UploadFile` (integration credits) | Supabase Storage, private bucket + signed URLs |
| AI / document parsing | Gemini key in `localStorage` | `llm` Edge Function, key in server env |
| Email | `sendInvoiceEmail` Deno function | Same function, ported to Supabase Edge Functions |
| Backend runtime | Base44 Deno functions | Supabase Edge Functions (also Deno — near 1:1) |

**Monthly cost: $0.**

---

## How the migration was done

The app made ~2,300 calls to the Base44 SDK across 24 files. Rather than
rewrite every call site, `src/api/base44Client.js` was replaced with a
compatibility adapter that exposes the identical surface on top of Supabase:

```js
base44.entities.Product.list('-created_date', 100)   // unchanged
base44.entities.CarrierRate.filter({ carrier_name })  // unchanged
base44.functions.invoke('sendInvoiceEmail', payload)  // unchanged
base44.integrations.Core.UploadFile({ file })         // unchanged
```

Only four files actually changed: the adapter, `AuthContext.jsx`,
`vite.config.js`, and `package.json`. Page and component code was not touched.

Server side, `supabase/functions/_shared/base44-compat.ts` does the same for
`createClientFromRequest` / `asServiceRole`, so each ported function needed a
single import line changed.

---

## Setup

### 1. Supabase

1. Create a project at supabase.com (free tier).
2. SQL Editor → paste and run `supabase/schema.sql`.
   Creates 9 tables, RLS policies, `profiles`, and the signup trigger.
3. Storage → create a **private** bucket named `uploads`.
4. Authentication → Providers → enable **Google** and **Email** (magic link).
5. Authentication → URL Configuration → add your Pages URL as a redirect URL.

### 2. Environment

```bash
cp .env.example .env.local   # fill in project URL + anon key
npm install
npm run dev
```

Only the anon key goes in the frontend. It is safe to publish — RLS is what
protects the data. **Never** put `service_role` in a `VITE_` variable.

### 3. Edge Functions

```bash
supabase link --project-ref YOUR-REF
supabase secrets set \
  GEMINI_API_KEY=...        \
  MAILGUN_API_KEY=...       \
  MAILGUN_DOMAIN=...        \
  ALLOWED_ORIGINS=https://shipflow-apl.pages.dev
supabase functions deploy llm sendInvoiceEmail processInvoicePdf splitInvoicePdf
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform — do not set them yourself.

### 4. Cloudflare Pages

Connect the GitHub repo, then:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_BUCKET`

`public/_redirects` handles SPA routing; `public/_headers` sets security and
cache headers. Both are picked up automatically.

---

## Commands

```bash
npm run dev      # local dev server
npm run check    # lint + tests + production build (run before pushing)
npm test         # adapter behaviour tests
npm run build    # production build to dist/
```

---

## Free-tier limits worth knowing

- **Supabase pauses a project after 7 days of no activity.** The
  `keepalive` GitHub Action pings it daily. Set `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` as repo secrets for it to work.
- Supabase free: 500 MB database, 1 GB storage, 5 GB egress/month, 2 active
  projects per organisation.
- Cloudflare Pages free: unlimited bandwidth, 500 builds/month.

---

## Known issues inherited from the Base44 version

- `TjxCanadaInvoiceLog` was used in `src/pages/TjxCanada.jsx` but never
  declared as an entity. A table was created for it from the call site; verify
  the columns match what you expect before relying on the archive view.
- Gemini and Supabase credentials were previously stored in `localStorage` and
  in a settings table readable by any signed-in user. They now live in Edge
  Function secrets. Rotate the old keys — assume they are compromised.
