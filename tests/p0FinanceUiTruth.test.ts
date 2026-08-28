import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("salary surfaces implement available Salary/Advance classification (P0-05 fix)", () => {
  const client = source("components/SalaryManagementClient.tsx");
  const types = source("lib/types.ts");

  // New behavior: type IS available and classified
  assert.match(client, /selectedType/); // UI state for type selection
  assert.match(client, /Salary.*Advance/); // Type selector buttons
  assert.match(client, /type: selectedType/); // Type included in API call
  // Old stale claims removed:
  assert.doesNotMatch(client, /Type unavailable/);
  assert.doesNotMatch(client, /type is not classified/i);
  // Type definition now includes Salary | Advance:
  assert.match(types, /type\?: "Salary" \| "Advance"/);
});

test("finance page routes to dedicated salary workspace", () => {
  const finance = source("app/(dashboard)/finance/page.tsx");

  assert.match(finance, /href="\/salary"/);
  assert.match(finance, /salary management/i); // "Open salary management" link
  // New behavior: type is now persisted and displayed in history
  assert.doesNotMatch(finance, /Type unavailable/);
});

test("Owner finance explicitly separates collection, receivable and custody meanings", () => {
  const finance = source("app/(dashboard)/finance/page.tsx");

  assert.match(finance, /Billed Services/);
  assert.match(finance, /Collections/);
  assert.match(finance, /Outstanding/);
  assert.match(finance, /Cash Handover/);
  assert.match(finance, /canonical 06_Payments only/);
  assert.match(finance, /Custody-only; never revenue/);
  assert.match(finance, /departments\.length === 1/);
  assert.match(finance, /clinic ledger/);
});
