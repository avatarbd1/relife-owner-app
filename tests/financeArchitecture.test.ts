import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("expense routes use the central Finance expense lifecycle", () => {
  const routes = [
    "app/api/finance/expense/request/route.ts",
    "app/api/finance/expense/pay/route.ts",
    "app/api/control/expense/route.ts",
  ];
  for (const route of routes) {
    assert.match(
      source(route),
      /@\/lib\/domain\/finance\/expenses/,
      `${route} must use the central Finance expense lifecycle`
    );
  }
});

test("cash routes use the central Finance cash lifecycle", () => {
  const routes = [
    "app/api/finance/cash/request/route.ts",
    "app/api/control/cash-movement/route.ts",
  ];
  for (const route of routes) {
    assert.match(
      source(route),
      /@\/lib\/domain\/finance\/cash/,
      `${route} must use the central Finance cash lifecycle`
    );
  }
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
