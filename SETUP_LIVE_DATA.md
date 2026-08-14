# Stage B: Setup Live Google Sheets Data

The app now fetches live data from your Google Sheets workbooks. Follow these steps to connect your Physio and Dental sheets.

## Overview

Your two workbooks contain 5 data sheets each:
- `06_Payments` → Collections
- `07_Expenses` → Operating expenses
- `08_Staff` → Staff roster with monthly salary commitment
- `13_Salary` → Salary payment history
- `21_Cash_Movement` → Cash transfers between buckets (Reception/Home Treasury/Bank)

The app will fetch **one CSV export URL per sheet per workbook**, so you'll have **2 sets of 5 URLs** (10 total).

## Step 1: Prepare Your Sheet Columns

Before publishing, ensure each sheet has these column headers (exact names, case-insensitive):

**06_Payments:**
- `date` (YYYY-MM-DD format)
- `amount` (numeric)
- `method` (e.g., "Cash", "Bank Transfer", "Cheque")
- `department` (one of: "Physio", "Dental", "Combined")

**07_Expenses:**
- `date` (YYYY-MM-DD format)
- `amount` (numeric)
- `category` (e.g., "Utilities", "Medicine", "Supplies")
- `department` (one of: "Physio", "Dental", "Combined")
- `isHouseholdWithdrawal` (TRUE/FALSE; household withdrawals are excluded from clinic expense)

**08_Staff:**
- `name` (staff name)
- `role` (job title)
- `monthlySalary` (numeric)
- `department` (one of: "Physio", "Dental", "Combined")

**13_Salary:**
- `date` (YYYY-MM-DD format, payment date)
- `name` (staff name)
- `amount` (numeric)
- `department` (one of: "Physio", "Dental", "Combined")

**21_Cash_Movement:**
- `date` (YYYY-MM-DD format)
- `fromBucket` (one of: "Reception", "Home Treasury", "Bank")
- `toBucket` (one of: "Reception", "Home Treasury", "Bank")
- `amount` (numeric)

## Step 2: Publish Each Sheet Tab as CSV

For **each of the 5 sheet tabs** in **both workbooks**:

1. Open the sheet tab in Google Sheets
2. Click **File** > **Share** > **Publish to web**
3. In the "Link" dropdown, select the **current sheet tab**
4. In the "Format" dropdown, select **Comma-separated values (.csv)**
5. Click **Publish**
6. Copy the URL from the text box at the top (looks like `https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=...`)
7. Repeat for each tab

You'll end up with 10 URLs total (5 per workbook).

## Step 3: Map URLs to Environment Variables

For your **Physio workbook** (Relife_Clinic_OS_Database_Template_FIXED), use the 5 URLs for environment variables that control which data scope is active. The app currently switches between Physio and Dental via the scope selector, so you need to map all your sheet tabs to the same variables.

**Recommendation:** Use your **Physio workbook URLs** as the primary sources. The scope selector will then be a UI-only toggle until you have separate Dental data wired. Or, implement dual-source fetching (one set of env vars per workbook).

For now, in `.env.local` (copy and paste your actual URLs):

```env
SHEET_PAYMENTS_CSV=https://docs.google.com/spreadsheets/d/YOUR_PHYSIO_ID/export?format=csv&gid=PAYMENTS_GID
SHEET_EXPENSES_CSV=https://docs.google.com/spreadsheets/d/YOUR_PHYSIO_ID/export?format=csv&gid=EXPENSES_GID
SHEET_STAFF_CSV=https://docs.google.com/spreadsheets/d/YOUR_PHYSIO_ID/export?format=csv&gid=STAFF_GID
SHEET_SALARY_CSV=https://docs.google.com/spreadsheets/d/YOUR_PHYSIO_ID/export?format=csv&gid=SALARY_GID
SHEET_CASH_CSV=https://docs.google.com/spreadsheets/d/YOUR_PHYSIO_ID/export?format=csv&gid=CASH_GID
```

## Step 4: Test Locally

```bash
npm run dev
```

1. Log in with your PIN (default `1234`)
2. Check the Home dashboard — numbers should now match your live sheets
3. Try switching scope from "Combined" to "Dental" to see if filtering works
4. Check the browser console for any CSV parsing errors

## Step 5: Reconcile Each Card

Compare each dashboard card against your existing Sheet/Bot:

- **Today's Collection** vs. `06_Payments` sum (today's date, all departments)
- **Month Business Position** vs. your manual calculation (month to date)
- **Fixed Salary Commitment** vs. sum of active staff `monthlySalary` in `08_Staff`
- **Cash Position** buckets vs. your ledger (may need reconciliation formula refinement)

If numbers don't match, check:
- CSV date format (must be YYYY-MM-DD)
- Department field values (must be exact: "Physio", "Dental", "Combined")
- Column header names (case-insensitive but must match expected names)

## Step 6: Deploy to Production

Once reconciled locally, set the same 5 environment variables in your deployment platform (Vercel, Railway, etc.) and redeploy.

## Troubleshooting

**"Failed to fetch CSV: 404"**
- The URL is incorrect or the sheet was unpublished
- Re-publish and copy the exact URL again

**Numbers don't match**
- Check CSV column headers match the expected names above
- Verify date format is YYYY-MM-DD
- Ensure department values are exact: "Physio", "Dental", or "Combined" (case-sensitive)
- Check for empty rows or hidden rows in the sheet

**Falls back to seed data**
- If any CSV fetch fails, the app logs the error and returns seed data
- Check browser DevTools console or server logs for the error message

## Future: Dual Workbook Support (Stage C?)

Currently, the scope selector is UI-only. To fully separate Physio vs. Dental data, you could:
1. Create separate env var sets: `SHEET_PAYMENTS_CSV_PHYSIO`, `SHEET_PAYMENTS_CSV_DENTAL`, etc.
2. Update the scope selector to switch between the two sets at fetch time
3. Requires changes to `lib/data/index.ts` and prop drilling the scope down from layout

For now, both scopes return the same Physio data. Let me know if you'd like to implement separate sources.
