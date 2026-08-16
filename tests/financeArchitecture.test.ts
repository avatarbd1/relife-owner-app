import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertProductionRoute(path: string): void {
  assert.match(
    source(path),
    /@\/lib\/domain\/finance\/production/,
    `${path} must use the final Finance production boundary`
  );
}

test("all finance write routes use one production boundary", () => {
  [
    "app/api/finance/payment/route.ts",
    "app/api/finance/expense/request/route.ts",
    "app/api/finance/expense/pay/route.ts",
    "app/api/control/expense/route.ts",
    "app/api/finance/cash/request/route.ts",
    "app/api/control/cash-movement/route.ts",
    "app/api/finance/salary/route.ts",
  ].forEach(assertProductionRoute);
});

test("finance production boundary delegates existing business rules", () => {
  const production = source("lib/domain/finance/production.ts");
  assert.match(production, /@\/lib\/domain\/finance\/payments/);
  assert.match(production, /@\/lib\/domain\/finance\/expenses/);
  assert.match(production, /@\/lib\/domain\/finance\/cash/);
  assert.match(production, /@\/lib\/domain\/finance\/salary/);
  assert.match(production, /@\/lib\/data\/supabaseFinance/);
});

test("duplicate expense writers are removed", () => {
  assert.equal(
    existsSync(new URL("../lib/webos/expenseRequests.ts", import.meta.url)),
    false
  );
  assert.equal(
    existsSync(new URL("../lib/webos/controlAudit.ts", import.meta.url)),
    false
  );
});

test("owner approval snapshot delegates finance parsing to domain modules", () => {
  const controls = source("lib/controls.ts");
  assert.match(controls, /listPendingExpenses/);
  assert.match(controls, /listPendingCashMovements/);
  assert.doesNotMatch(controls, /function parsePendingExpenses/);
  assert.doesNotMatch(controls, /function parsePendingCash/);
});
