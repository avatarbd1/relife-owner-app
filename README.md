# Relife Owner Web App — Stage A

Mobile-first, read-only Owner dashboard for Relife Clinic (Physio + Dental).
This is the **Stage A** build from the project plan: project structure,
mobile UI, Owner PIN login, navigation, the Combined / Physio / Dental scope
selector, and a read-only data service layer.

## What's real vs. sample right now

- **App structure, auth, navigation, scope selector, calculation logic**:
  fully built and working.
- **Numbers on the Home dashboard**: driven by sample/seed data in
  `data/seed/*.json`, shaped exactly like the real sheet schema
  (06_Payments, 07_Expenses, 08_Staff, 13_Salary, 21_Cash_Movement). They
  are **not** your live Google Sheets numbers yet — that's Stage B.
  A "Sample data" badge shows in the header as a reminder.
- Two figures were deliberately seeded to match numbers you already gave me
  so you can sanity-check the logic: switch scope to **Dental** and you'll
  see Fixed salary commitment = ৳69,000 (Avatar + Rakib + Hasibur) and
  Variable clinic expense = ৳7,065, with the ৳3,000 household withdrawal
  correctly excluded from clinic expense.
- **Fixed overhead** has no confirmed source sheet/tab yet in the data
  contract you gave me, so it's hardcoded to ৳0 with a note on the card.
  Tell me where that should come from and I'll wire it up.
- **Cash Position** buckets (Reception / Home Treasury / Bank) are computed
  from a seeded ledger in `data/seed/cashMovements.json`. The real
  bucket-derivation formula (which payment methods land in which bucket,
  how transfers are recorded) needs to be reconciled against your existing
  Sheet/Bot — that reconciliation is explicitly Stage B work per the plan.

## Project structure

```
app/
  login/              PIN login screen
  (dashboard)/         Owner-only routes (protected by proxy.ts)
    layout.tsx          top scope selector + bottom nav shell
    home/               Home dashboard (the 4 cards)
    finance/            stub (Stage C)
    patients/           stub (Stage D)
    reports/            stub (Stage D)
    more/               settings + logout (Stage E will add write access)
  api/
    login/  logout/  scope/   route handlers
lib/
  auth.ts             PIN check + signed session cookie
  types.ts            Payment / Expense / StaffMember / SalaryPayment / CashMovement
  data/index.ts        READ-ONLY DATA SERVICE — swap this for live Sheets in Stage B
  calculations.ts      all dashboard business logic (today's collection, month
                        position, salary status, cash position)
  format.ts            ৳ currency formatting (lakh/crore grouping)
data/seed/*.json       sample data matching the real sheet schema
proxy.ts               route protection (Next.js 16 renamed "middleware" to "proxy")
```

## Running locally

```bash
npm install
cp .env.local.example .env.local   # then edit OWNER_PIN and SESSION_SECRET
npm run dev
```

Open http://localhost:3000 on your phone (same network) or desktop browser.
Default PIN if you don't set `.env.local` is `1234` — change it before any
real use.

## Deploying to get a real live URL

I can't create a public URL directly from this session (no hosting
credentials here). Two straightforward options:

1. **Vercel (recommended, easiest for Next.js)**
   - Push this folder to a GitHub repo, then import it at vercel.com, or
     run `npx vercel` from this folder if you have the Vercel CLI.
   - Set `OWNER_PIN` and `SESSION_SECRET` as environment variables in the
     Vercel project settings before your first real login.
   - If you connect your Vercel account to Claude (the Vercel connector),
     I can drive the deploy directly next time instead of you doing it by
     hand — just say the word.

2. **Any other Node host** (Railway, Render, your own VPS): `npm run build`
   then `npm run start`, with the same two env vars set.

## Stage B — connecting live Google Sheets (next step)

I found your two live workbooks in Google Drive:
- **Relife_Clinic_OS_Database_Template_FIXED** → Physio
- **Relife Dental OS** → Dental

To wire `lib/data/index.ts` to these for real, the cleanest options are:
- A Google Cloud service account with Viewer access shared on both sheets,
  read via the Sheets API (most robust, a bit of one-time setup on your
  end), or
- Publishing the specific tabs (06_Payments, 07_Expenses, 08_Staff,
  13_Salary, 21_Cash_Movement) to the web as CSV and fetching those URLs
  (much faster to set up, slightly less locked-down).

Once you pick one, Stage B is: implement the fetch in `lib/data/index.ts`,
set `IS_LIVE_DATA = true`, and reconcile each card's number against the
existing Sheet/Bot one at a time, exactly as the plan describes.
