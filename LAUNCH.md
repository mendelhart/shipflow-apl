# Get ShipFlow APL launched

18 August 2026 · code is in `shipflow-apl-files.zip`

Seven steps, in this order, start to finish. About an hour.
Don't skip ahead — each one depends on the last.

Everything before this point is done: the database, your 101 rows of data, the
security rules, the Cloudflare project, the build settings and the sign-in URLs.
I finished those. What's left needs passwords, and I don't handle passwords.

---

## About the API keys — read this once

There are five credentials in this system. Here's who holds what:

| Credential | Where it goes | Can I handle it? |
|---|---|---|
| Supabase publishable key | Cloudflare build variable | **Already done.** It's public by design — it ships inside the app for anyone to read. Row-level security is what protects your data, not this key. |
| Gemini API key | Supabase Edge Function secret | **No.** You paste it. Step 2 + 6. |
| Mailgun API key | Supabase Edge Function secret | **No.** You paste it. Step 2 + 6. |
| Mailgun SMTP password | Supabase Auth SMTP settings | **No.** You paste it. Step 3. |
| Supabase `service_role` key | Nowhere — Supabase injects it | Never touch it. If it ever appears in a `VITE_` variable, your database is wide open. |

So: nothing to send me. The four I can't handle are the four steps below with
your name on them. If you'd rather I sat with you while you do them, say so and
I'll walk them one at a time.

---

# Step 1 — Get the code onto GitHub

**Why first:** your repo still holds the original migration code. Everything
from the review — the security fixes, the label rewrite, the product page — is
only in the zip. Cloudflare builds whatever is on GitHub, so until this is done
the site stays blank and nothing else in this guide can be tested.

`git` isn't installed on your machine, which is why PowerShell said *"'git' is
not recognized"*. GitHub Desktop brings its own copy and does this with buttons.

**1a.** Install GitHub Desktop from **https://desktop.github.com**.

On first launch choose **"Sign in to GitHub.com"** — it opens your browser and
uses the account you're already logged into. No password typed into the app.
When it asks for a commit name and email, use your name and
`mhart@capitalnutrition.ca`.

**1b.** **File → Clone repository → GitHub.com tab** → pick
`mendelhart/shipflow-apl` → **Clone**.

Note the **Local path** it shows you — probably
`C:\Users\Morris\Documents\GitHub\shipflow-apl`.

**1c.** Unzip `shipflow-apl-files.zip` from your Downloads. You get a folder
called `shipflow-apl` containing `src`, `supabase`, `package.json` and so on.

**1d.** Open the folder GitHub Desktop cloned into.

In File Explorer, click the **View** tab and make sure **"Hidden items" is
UNCHECKED.** This keeps the hidden `.git` folder out of your selection — that
folder is what connects this directory to GitHub, and deleting it breaks the
link.

Now **Ctrl+A**, then **Delete**. The folder will look empty. It isn't.

**1e.** Open the unzipped `shipflow-apl` folder, go **inside** it, **Ctrl+A →
Ctrl+C**. Back to the cloned folder, **Ctrl+V**.

The cloned folder should now contain `src`, `supabase`, `package.json` —
*not* a folder called `shipflow-apl` containing those. If you got a nested
folder, you copied the folder instead of its contents. Undo and copy from
inside it.

**1f.** In GitHub Desktop, type a summary at the bottom left:
`Senior review: security, reliability and correctness fixes`
→ **Commit to main** → **Push origin**.

> **Checkpoint.** On GitHub, the **Actions** tab should show a run that finishes
> green in about a minute. That's lint, 43 tests and a production build.
> **A red X means stop and tell me** — Cloudflare will build the same broken
> thing.
>
> Then Cloudflare → Workers & Pages → shipflow-apl → **Deployments**. A new
> build starts by itself and takes 2–3 minutes.
>
> Then open **https://shipflow-apl.pages.dev**. It should show a sign-in screen
> instead of a blank page. Don't sign in yet.

---

# Step 2 — Rotate the two keys

**Why now:** both were readable by anyone with an account. The Mailgun key sat
in a database row; the Gemini key sat in browser storage. Assume both are
compromised. Do this before pasting anything anywhere, so you only paste the
new ones.

**Mailgun** → https://app.mailgun.com → Sending → Domain settings → **Sending
API keys** → create a new key, delete the old one.

**Gemini** → https://aistudio.google.com/apikey → create a new key, delete the
old one.

Keep both somewhere you can copy from for step 6. Neither one goes into a
`VITE_` variable — those get baked into the public app.

---

# Step 3 — Fix the 2-emails-per-hour cap

**Why now:** before you or anyone else tries to sign in.

Your project can currently send **2 sign-in emails per hour. Total. Across
everyone.** That's Supabase's built-in mail service and they won't raise it.
Sign-in is by emailed link, so that's a ceiling of two sign-ins an hour for the
whole company. You'd hit it the first morning three people use it.

The fix is to point Supabase at the Mailgun account you already pay for.

**3a.** In Mailgun: Sending → Domain settings → **SMTP credentials**. This is a
*different screen* from the API key in step 2 — a username that looks like an
email address, and its own password. If no password is shown, reset it to
generate one.

**3b.** In Supabase: **Authentication → Emails → SMTP Settings → Enable custom
SMTP**, then:

| Field | Value |
|---|---|
| Host | `smtp.mailgun.org` |
| Port | `587` |
| Username | the SMTP username from 3a |
| Password | the SMTP password from 3a |
| Sender email | `noreply@` + your verified Mailgun domain |
| Sender name | `Capital Nutrition Shipping` |

Save.

**3c.** **Authentication → Rate Limits** → change **emails/h** from `2` to `100`
→ Save changes.

> **Checkpoint.** The emails/h field should now accept a number above 2. If
> Supabase refuses, SMTP didn't save — recheck the username and password.

---

# Step 4 — Sign in and become admin

Go to **https://shipflow-apl.pages.dev**, type `mhart@capitalnutrition.ca`,
click **Email me a sign-in link**, then open the link in the email.

Your profile is created automatically and made an admin — that rule is in the
database and names your address specifically.

> **Checkpoint.** You land on the Dashboard and can see your purchase orders and
> products. If every page is empty, tell me: it means the profile didn't
> activate and I'll look.

Anyone with a `@capitalnutrition.ca` address is auto-approved on first sign-in.
Everyone else lands inactive and sees nothing until you activate them.

---

# Step 5 — Close the door

Right now anyone on the internet can create an account. They can't read a
single row — the security rules stop them — but there's no reason to leave it
open.

**Supabase → Authentication → Sign In / Providers → Email → turn off new
sign-ups.**

**Do this after step 4, not before,** or you'll lock yourself out.

---

# Step 6 — Turn on email, AI and PDF splitting

These three features live in "Edge Functions" and **have never once run
successfully** — all of them had a bug that returned an error on every single
call. This is switching on new functionality, not a redeploy. Expect to test it.

**6a. Set the secrets first.** Supabase → **Edge Functions → Secrets** → add:

```
GEMINI_API_KEY   = your new Gemini key from step 2
MAILGUN_API_KEY  = your new Mailgun key from step 2
MAILGUN_DOMAIN   = your Mailgun sending domain, e.g. mg.capitalnutrition.ca
ALLOWED_ORIGINS  = https://shipflow-apl.pages.dev
```

`ALLOWED_ORIGINS` must be exactly that — no trailing slash, no `www`. Get it
wrong and every call from the browser fails with a message that explains
nothing.

**6b. Deploy the four functions.** Supabase → Edge Functions → **Deploy a new
function → via editor**. There are four, in `supabase/functions/` in the folder
you unzipped:

- `llm`
- `sendInvoiceEmail`
- `processInvoicePdf`
- `splitInvoicePdf`

Each one also needs the shared file `_shared/base44-compat.ts` alongside it —
the editor lets you add a second file to a function.

This is fiddly. If you have Node installed (`node --version` in PowerShell),
there's a much faster route:

```powershell
npm install -g supabase
supabase login
supabase link --project-ref nscoiiinosqhraoujcss
supabase functions deploy
```

`npm` works even though `git` doesn't, as long as Node is installed. **Tell me
which route you're taking and I'll walk it with you** — this is the step most
likely to go sideways.

---

# Step 7 — Test saves, not reads

This is the part that matters. Every serious defect the review found was
invisible to a read-only check: the app listed data perfectly and failed on
every single write.

- [ ] Create a purchase order and save it
- [ ] Open Settings, change something, save
- [ ] Edit a product and save; then bulk-edit several at once
- [ ] Save a customer invoice, reopen it, edit it — confirm **one** record, not two
- [ ] Generate carton labels for the 2,128-box PO — seconds, and the tab survives
- [ ] Send a test invoice email to yourself
- [ ] Upload an invoice PDF and let the AI read it

If any of these fail you'll now get an error that says what went wrong. That
wasn't true before — all nine save paths failed silently.

---

## If something goes wrong

**Blank page** — build variables missing, or the build failed. Cloudflare →
Deployments → click the latest → read the log.

**"Check your email" and nothing arrives** — the 2/hour cap. Step 3.

**Signed in but every page is empty** — profile not active. Supabase → Table
Editor → `profiles` → set `is_active` to true on your row.

**Edge Function calls fail with a CORS error** — `ALLOWED_ORIGINS` doesn't
exactly match the site URL.

**It worked, now it doesn't** — Cloudflare → Deployments → last good one →
**Rollback**. Instant, and it doesn't touch your data.

---

## After launch

- Two pairs of products share a barcode (`1002`/`1003`, `1099G`/`1099P`). A data
  error, not a bug — AI import will attach line items to whichever it finds.
- The logo is still hot-linked from `base44.app` and will break when they take
  it down.
- Next Level – Ship Tool hasn't been migrated yet. Extracted and mapped, not
  started.

**Cost: $0 CAD.** Cloudflare Pages is free at this scale; Supabase's free tier
covers 500 MB of database and 1 GB of files and you're using a fraction of both.
Mailgun you already pay for.
