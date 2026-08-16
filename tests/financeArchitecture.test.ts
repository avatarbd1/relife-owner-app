import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertDomainRoute(path: string, module: string): void {
  assert.match(
    source(path),
    new RegExp(`@/lib/domain/finance/${module}`.replaceAll("/", "\\/")),
    `${path} must use Finance domain ${module}`
  );
}

test("payment writes use Finance domain", () => {
  assertDomainRoute("app/api/finance/payment/route.ts", "payments");
});

test("expense lifecycle routes use Finance domain", () => {
  assertDomainRoute("app/api/finance/expense/request/route.ts", "expenses");
  assertDomainRoute("app/api/finance/expense/pay/route.ts", "expenses");
  assertDomainRoute("app/api/control/expense/route.ts", "expenses");
});

test("cash lifecycle routes use Finance domain", () => {
  assertDomainRoute("app/api/finance/cash/request/route.ts", "cash");
  assertDomainRoute("app/api/control/cash-movement/route.ts", "cash");
});

test("salary writes use Finance domain", () => {
  assertDomainRoute("app/api/finance/salary/route.ts", "salary");
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
