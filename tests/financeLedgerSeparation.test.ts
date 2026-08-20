import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("finance records are separated into dedicated ledgers", () => {
  const hub = read("app/(dashboard)/finance/records/page.tsx");
  for (const route of [
    "/finance/daily-collection",
    "/finance/collection-history",
    "/finance/expense-history",
    "/finance/cash-history",
    "/finance/salary-history",
    "/finance/audit",
  ]) {
    assert.match(hub, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("finance ledger reads stay role and department scoped", () => {
  const source = read("lib/webos/financeLedgers.ts");
  assert.match(source, /canPerform\(context, "payment\.read_amount", department\)/);
  assert.match(source, /canPerform\(context, "report\.read_financial", department\)/);
  assert.match(source, /scopeAllows\(scope, department\)/);
  assert.match(source, /normalize\(row\.paidFrom \|\| row\.paymentMethod\) !== "reception"/);
  assert.match(source, /normalize\(row\.fromCustodian\) !== "reception"/);
  assert.match(source, /role === "Owner" \|\| role === "Auditor"/);
});

test("daily collection and full histories expose filters without mixing write workflows", () => {
  const client = read("components/FinanceLedgerClient.tsx");
  assert.match(client, /Last 7 days/);
  assert.match(client, /This month/);
  assert.match(client, /Custom/);
  assert.match(client, /Department/);
  assert.match(client, /Search/);
  assert.match(client, /Method/);
  assert.match(client, /Status/);
  assert.match(client, /kind === "audit"/);
});

test("legacy mixed history routes to the separated records hub", () => {
  const history = read("app/(dashboard)/finance/history/page.tsx");
  assert.match(history, /redirect\("\/finance\/records"\)/);
});

test("finance audit is restricted to Owner or Auditor", () => {
  const audit = read("app/(dashboard)/finance/audit/page.tsx");
  assert.match(audit, /role === "Owner" \|\| role === "Auditor"/);
  assert.match(audit, /redirect\("\/finance\/records"\)/);
});
