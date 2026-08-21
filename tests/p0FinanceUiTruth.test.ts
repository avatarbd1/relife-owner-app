import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("salary surfaces do not claim an unavailable Salary/Advance classification", () => {
  const page = source("app/(dashboard)/salary/page.tsx");
  const client = source("components/SalaryManagementClient.tsx");
  const data = source("lib/data/index.ts");

  assert.doesNotMatch(page, /paid\/advance history/i);
  assert.match(page, /actual 13_Salary ledger history/i);
  assert.match(client, /Type unavailable/);
  assert.match(client, /type is not classified/i);
  assert.doesNotMatch(data, /type:\s*"Advance" as const/);
});

test("mixed finance operations routes payroll to the dedicated salary workspace", () => {
  const operations = source("app/(dashboard)/finance/operations/page.tsx");

  assert.match(operations, /salaryPay:\s*false/);
  assert.match(operations, /salaryHistory:\s*false/);
  assert.match(operations, /href="\/salary"/);
  assert.match(operations, /Salary management/);
  assert.match(operations, /type: row\.type \|\| "Type unavailable"/);
  assert.doesNotMatch(operations, /new Set\(\["payment", "expenses", "cash", "salary"\]\)/);
});

test("Owner finance explicitly separates collection, receivable and custody meanings", () => {
  const finance = source("app/(dashboard)/finance/page.tsx");

  assert.match(finance, /Billed Services/);
  assert.match(finance, /Collections/);
  assert.match(finance, /Outstanding/);
  assert.match(finance, /Cash Handover/);
  assert.match(finance, /canonical 06_Payments only/);
  assert.match(finance, /Custody-only; never revenue/);
  assert.match(finance, /Combined is a read-only Physio \+ Dental aggregation/);
});
