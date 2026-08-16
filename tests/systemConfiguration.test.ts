import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Relife system identity is centralized and typed", () => {
  const config = source("lib/config/relifeSystem.ts");
  assert.match(config, /organizationId: "RELIFE"/);
  assert.match(config, /branchId: "AMTALI-01"/);
  assert.match(config, /timeZone: "Asia\/Dhaka"/);
  assert.match(config, /ledgerClinicId/);
  assert.match(config, /not future multi-tenant primary keys/);
});

test("Finance write domains consume typed system configuration", () => {
  for (const path of [
    "lib/domain/finance/payments.ts",
    "lib/domain/finance/expenses.ts",
    "lib/domain/finance/cash.ts",
    "lib/domain/finance/salary.ts",
  ]) {
    const text = source(path);
    assert.match(text, /@\/lib\/config\/relifeSystem/);
    assert.doesNotMatch(text, /function clinicId\(/);
    assert.doesNotMatch(text, /timeZone: "Asia\/Dhaka"/);
    assert.doesNotMatch(text, /Organization_ID: "RELIFE"/);
    assert.doesNotMatch(text, /Branch_ID: "AMTALI-01"/);
    assert.doesNotMatch(text, /Schema_Version: "relife-uda-v1"/);
  }
});
