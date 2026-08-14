# Stage B: Live Data — Quick Start

## What's Changed

✅ `lib/data/index.ts` now fetches live CSV data from Google Sheets instead of seed JSON  
✅ All parsing logic handles the full Payment/Expense/Staff/SalaryPayment/CashMovement schemas  
✅ Graceful fallback to seed data if any CSV fetch fails (e.g., invalid URL, network error)  
✅ `IS_LIVE_DATA` flag auto-detects when CSV environment variables are set

## To Enable Live Data: 3 Steps

### 1. Publish Your Sheet Tabs as CSV

In **both** your Relife workbooks (Physio & Dental):
- Open each tab: `06_Payments`, `07_Expenses`, `08_Staff`, `13_Salary`, `21_Cash_Movement`
- **File** → **Share** → **Publish to web**
- Select the sheet tab from dropdown
- Change format to **CSV**
- Click **Publish**
- Copy the URL (looks like `https://docs.google.com/spreadsheets/d/...SHEET_ID.../export?format=csv&gid=...`)

### 2. Set Environment Variables

Copy your CSV URLs into `.env.local`:

```env
SHEET_PAYMENTS_CSV=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&gid=YOUR_GID
SHEET_EXPENSES_CSV=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&gid=YOUR_GID
SHEET_STAFF_CSV=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&gid=YOUR_GID
SHEET_SALARY_CSV=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&gid=YOUR_GID
SHEET_CASH_CSV=https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&gid=YOUR_GID
```

### 3. Test Locally

```bash
npm run dev
```

- Log in (PIN: 1234)
- Check Home dashboard — numbers should match your live Google Sheets
- Open browser DevTools Console if you get any fetch errors

## What CSV Columns You Need

The parser is flexible with column names (case-insensitive, underscore/camelCase interchangeable).  
Each sheet needs these columns:

| Sheet | Columns |
|-------|---------|
| **06_Payments** | receiptNo, date, patientId, patientName, department, amount, discount, due, paymentMethod, receivedBy, remarks (optional) |
| **07_Expenses** | expenseId, date, category, description, amount, paymentMethod, paidBy, department, isHouseholdWithdrawal |
| **08_Staff** | staffId, fullName, phone (optional), role, department, salary, status |
| **13_Salary** | id, date, staffId, staffName, department, amount, type |
| **21_Cash_Movement** | id, date, bucket, amount, remarks (optional) |

Dates must be in **YYYY-MM-DD** format.  
Department must be exactly **Physio** or **Dental** (case-sensitive).

## Troubleshooting

**Numbers don't match → Check:**
- CSV column headers match expected names
- Date format is YYYY-MM-DD
- Department values are exact: "Physio" or "Dental"
- Empty rows in sheet (parser skips row 1 as headers; empty data rows will parse as 0s)

**"Failed to fetch CSV" error → Check:**
- URL is correct (copy-paste from publish dialog again)
- Sheet tab was successfully published
- Not behind a firewall blocking docs.google.com

**Still using seed data → Check:**
- All 5 env vars are set (if any is missing, falls back to seed)
- You ran `npm run dev` after editing .env.local (Next.js needs restart)

## For Deployment (Vercel/Railway/etc)

Set the same 5 environment variables in your platform's dashboard, then redeploy. The app will fetch live data in production.

## Next Steps

1. ✅ Set up CSV exports (Step 1–2 above)
2. Verify numbers match your existing Sheet/Bot
3. Switch scope selector (Physio ↔ Dental) and reconcile each card
4. Deploy with env vars set

**Full setup details** in `SETUP_LIVE_DATA.md`.
