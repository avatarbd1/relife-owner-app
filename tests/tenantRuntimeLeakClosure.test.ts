import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("finance ledger and mixed history use one tenant-scoped data boundary", () => {
  const ledgers = source("lib/webos/financeLedgers.ts");
  const history = source("lib/webos/financeHistory.ts");

  for (const text of [ledgers, history]) {
    assert.match(text, /tenantFinanceData/);
    assert.doesNotMatch(text, /getCashMovementsForAdminView/);
    assert.doesNotMatch(text, /\bgetPayments\(\)/);
    assert.doesNotMatch(text, /\bgetExpenses\(\)/);
    assert.doesNotMatch(text, /\bgetSalaryPayments\(\)/);
  }
});

test("tenant finance data preserves Relife department mapping but exact-matches every SaaS tenant", () => {
  const data = source("lib/webos/tenantFinanceData.ts");
  assert.match(data, /getPayments\("RELIFE", "RELIFE-PHYSIO"\)/);
  assert.match(data, /getPayments\("RELIFE", "RELIFE-DENTAL"\)/);
  assert.match(data, /getCashMovements\("RELIFE", "RELIFE-PHYSIO"\)/);
  assert.match(data, /getCashMovements\("RELIFE", "RELIFE-DENTAL"\)/);
  assert.match(data, /getPayments\(tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(data, /getExpenses\(tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(data, /getCashMovements\(tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(data, /getSalaryPayments\(tenant\.organizationId, tenant\.clinicId\)/);
});

test("finance operations and payment recents use tenant-native snapshot", () => {
  const operationsPage = source("app/(dashboard)/finance/operations/page.tsx");
  const paymentsPage = source("app/(dashboard)/payments/page.tsx");
  const snapshot = source("lib/webos/tenantFinanceOps.ts");

  assert.match(operationsPage, /getTenantFinanceOperationsSnapshot\(context, scope, tenantContext\.tenant\)/);
  assert.match(operationsPage, /getFinanceHistorySnapshot\(context, scope, tenantContext\.tenant\)/);
  assert.match(paymentsPage, /getTenantFinanceOperationsSnapshot\(context, scope, tenantContext\.tenant\)/);

  assert.match(snapshot, /listTenantScopedWebStaffDirectory\(tenant\)/);
  assert.match(snapshot, /getVisiblePatients\(context, scope, tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(snapshot, /readTenantPayments\(tenant, scope\)/);
  assert.match(snapshot, /readTenantExpenses\(tenant, scope\)/);
  assert.doesNotMatch(snapshot, /getWebStaffDirectory/);
  assert.doesNotMatch(snapshot, /fetchSheetRanges/);
});

test("disabled advanced finance, salary and audit ledgers are hidden and direct URLs are gated", () => {
  const records = source("app/(dashboard)/finance/records/page.tsx");
  const ledgerPage = source("components/FinanceLedgerPage.tsx");
  const operations = source("app/(dashboard)/finance/operations/page.tsx");

  assert.match(records, /hasTenantFeature\(tenantContext\.tenant, "optional\.finance_advanced"\)/);
  assert.match(records, /hasTenantFeature\(tenantContext\.tenant, "optional\.salary"\)/);
  assert.match(records, /hasTenantFeature\(tenantContext\.tenant, "optional\.audit_viewer"\)/);

  assert.match(ledgerPage, /kind === "cash-history"[\s\S]*requireTenantFeature\(tenant, "optional\.finance_advanced"\)/);
  assert.match(ledgerPage, /kind === "salary-history"[\s\S]*requireTenantFeature\(tenant, "optional\.salary"\)/);
  assert.match(ledgerPage, /kind === "audit"[\s\S]*requireTenantFeature\(tenant, "optional\.audit_viewer"\)/);

  assert.match(operations, /cashRequest: advancedFinanceEnabled && snapshot\.capabilities\.cashRequest/);
  assert.match(operations, /const canOpenSalary = salaryEnabled/);
});

test("new appointment setup exposes only this clinic's departments and staff", () => {
  const page = source("app/(dashboard)/appointments/new/page.tsx");
  const gate = source("components/AppointmentBookingGate.tsx");
  const clinicians = source("lib/webos/tenantClinicians.ts");

  assert.match(page, /clinicRuntimeDepartments\(configuration\.profile\?\.clinicType\)/);
  assert.match(page, /getTenantClinicianOptions\(context, tenant\)/);
  assert.match(page, /availableDepartments=\{availableDepartments\}/);
  assert.match(page, /modalityOptions=\{\[\]\}/);
  assert.doesNotMatch(page, /getBookingModalityOptions/);
  assert.doesNotMatch(page, /getClinicianOptions/);

  assert.match(gate, /availableDepartments\.map/);
  assert.doesNotMatch(gate, /\(\["Physio", "Dental"\] as Department\[\]\)\.map/);
  assert.match(clinicians, /listTenantScopedWebStaffDirectory\(tenant\)/);
  assert.doesNotMatch(clinicians, /getWebStaffDirectory/);
});
