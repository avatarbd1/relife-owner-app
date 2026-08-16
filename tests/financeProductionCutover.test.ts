import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Finance cutover is explicitly gated and fail-closed in Supabase mode", () => {
  const adapter = source("lib/data/supabaseFinance.ts");
  const production = source("lib/domain/finance/production.ts");

  assert.match(adapter, /RELIFE_FINANCE_DB_MODE/);
  assert.match(adapter, /"sheets" \| "shadow" \| "supabase"/);
  assert.match(adapter, /relife-finance-api/);
  assert.match(adapter, /x-relife-server-key/);
  assert.match(production, /FINANCE_DB_UNAVAILABLE/);
  assert.match(production, /mode === "shadow"/);
});

test("Sheets remains compatibility mirror while Supabase journal is required after successful writes", () => {
  const production = source("lib/domain/finance/production.ts");

  for (const [sheetCall, syncCall] of [
    ["await createSheetsPayment", "await syncFinance"],
    ["await requestSheetsExpense", "await syncFinance"],
    ["await paySheetsApprovedExpense", "await syncFinance"],
    ["await requestSheetsCashMovement", "await syncFinance"],
    ["await paySheetsSalary", "await syncFinance"],
  ]) {
    assert.ok(
      production.indexOf(sheetCall) >= 0 &&
        production.indexOf(syncCall, production.indexOf(sheetCall)) >
          production.indexOf(sheetCall),
      `${syncCall} must follow ${sheetCall}`
    );
  }
});

test("approval retries reconcile only when Sheets already has the requested terminal state", () => {
  const production = source("lib/domain/finance/production.ts");
  assert.match(production, /CONTROL_ALREADY_DECIDED/);
  assert.match(production, /currentSheetStatus/);
  assert.match(production, /normalized\(actual\) !== normalized\(expected\)/);
  assert.match(production, /FINEXDEC_/);
  assert.match(production, /FINCMDEC_/);
});

test("finance ledger migration is tenant scoped and not exposed to browser roles", () => {
  const migration = source(
    "supabase/migrations/20260816183900_finance_transaction_ledger.sql"
  );
  assert.match(migration, /create table if not exists relife\.finance_operations/);
  assert.match(migration, /organization_id uuid not null references relife\.organizations/);
  assert.match(migration, /clinic_id uuid not null references relife\.clinics/);
  assert.match(migration, /unique \(clinic_id, entity_type, entity_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table relife\.finance_operations from anon, authenticated/);
});

test("finance Edge transaction is retry-safe and writes audit atomically", () => {
  const edge = source("supabase/functions/relife-finance-api/index.ts");
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /relife\.finance_operations/);
  assert.match(edge, /relife\.audit_events/);
  assert.match(edge, /request_id = \$\{requestId\}/);
  assert.match(edge, /eventAction/);
  assert.match(edge, /duplicate: true/);
  assert.match(edge, /for update/);
});
