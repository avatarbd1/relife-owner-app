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
  assert.match(data, /legacyLedgerTenant\("Physio"\)/);
  assert.match(data, /legacyLedgerTenant\("Dental"\)/);
  assert.match(data, /getPayments\(physioTenant\.organizationId, physioTenant\.clinicId\)/);
  assert.match(data, /getCashMovements\(dentalTenant\.organizationId, dentalTenant\.clinicId\)/);
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

test("Relife Supabase Chamber cutover cannot be merged into another tenant", () => {
  const read = source("lib/domain/appointments/read.ts");
  assert.match(read, /isRelifeLegacyTenant\(tenant\)/);
  assert.match(read, /getAppointmentsForContext\([\s\S]*tenant\.organizationId,[\s\S]*tenant\.clinicId/);
  assert.match(read, /!isRelifeLegacyTenant\(tenant\) \|\| !needsSupabasePhysio/);
});

test("staff home reads active tenant only and applies feature flags before exposing actions", () => {
  const home = source("lib/webos/staffHome.ts");
  const client = source("components/StaffHomeWorkspace.tsx");

  assert.match(home, /resolveStaffTenantContext\(context\.staffId\)/);
  assert.match(home, /getAppointmentsForContext\(context, scope, date, tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(home, /listTenantScopedWebStaffDirectory\(tenant\)/);
  assert.match(home, /hasTenantFeature\(tenant, "optional\.finance_advanced"\)/);
  assert.match(home, /hasTenantFeature\(tenant, "optional\.inventory"\)/);
  assert.match(home, /hasTenantFeature\(tenant, "optional\.live_chamber"\)/);
  assert.match(home, /hasTenantFeature\(tenant, "optional\.live_chat"\)/);
  assert.doesNotMatch(home, /getWebStaffDirectory/);
  assert.doesNotMatch(home, /getDailyClinicalActivity/);
  assert.match(client, /if \(capabilities\.liveChat\)/);
});

test("audit page and audit reader fail closed by tenant and feature", () => {
  const page = source("app/(dashboard)/audit/page.tsx");
  const overview = source("lib/webos/adminOverview.ts");

  assert.match(page, /requireTenantFeature\(tenantContext\.tenant, "optional\.audit_viewer"\)/);
  assert.match(page, /getAuditOverview\(context, scope, tenantContext\.tenant\)/);
  assert.match(overview, /if \(organizationIdx < 0 \|\| clinicIdx < 0\) return \[\]/);
  assert.match(overview, /organizationId === tenant\.organizationId && clinicId === tenant\.clinicId/);
  assert.match(overview, /isRelifeLegacyTenant\(tenant\)/);
});

test("patient registration cannot decrement Relife inventory for SaaS tenants", () => {
  const route = source("app/api/patients/route.ts");
  assert.match(route, /isRelifeLegacyTenant\(tenant\)/);
  assert.match(route, /hasTenantFeature\(tenant, "optional\.inventory"\)/);
  assert.match(route, /if \(legacyInventoryEnabled\)/);
  assert.match(route, /consumePhysioInventorySystem/);
});

test("legacy inventory page and mutation fail closed outside canonical Relife", () => {
  const page = source("app/(dashboard)/inventory/page.tsx");
  const actions = source("app/(dashboard)/inventory/actions.ts");

  assert.match(page, /requireTenantFeature\(tenant, "optional\.inventory"\)/);
  assert.match(page, /if \(!isRelifeLegacyTenant\(tenant\)\)/);
  assert.match(actions, /requireTenantFeature\(tenant, "optional\.inventory"\)/);
  assert.match(actions, /if \(!isRelifeLegacyTenant\(tenant\)\) throw new Error\("LEGACY_INVENTORY_NOT_AVAILABLE"\)/);
});

test("owner home hides advanced cash and live chat when tenant features are disabled", () => {
  const page = source("app/(dashboard)/home/page.tsx");
  assert.match(page, /hasTenantFeature\(tenant, "optional\.finance_advanced"\)/);
  assert.match(page, /hasTenantFeature\(tenant, "optional\.live_chat"\)/);
  assert.match(page, /advancedFinanceEnabled[\s\S]*getScopedCashPositionForAdminView/);
  assert.match(page, /\{advancedFinanceEnabled && \(/);
  assert.match(page, /\{liveChatEnabled && <QuickButton/);
});

test("daily register is derived from tenant finance data instead of raw Relife sheet reads", () => {
  const register = source("lib/webos/dailyRegister.ts");
  const page = source("app/(dashboard)/register/page.tsx");
  const daily = source("app/(dashboard)/daily/page.tsx");

  assert.match(register, /readTenantPayments\(tenant, scope\)/);
  assert.doesNotMatch(register, /fetchSheetRanges/);
  assert.match(page, /getDailyRegisterSnapshot\(access, scope, tenant, params\.date\)/);
  assert.match(daily, /getDailyRegisterSnapshot\(context, scope, tenantContext\.tenant, safeSnapshot\.date\)/);
});

test("legacy same-day corrections cannot read or mutate Relife rows from another tenant", () => {
  const page = source("app/(dashboard)/corrections/page.tsx");
  const route = source("app/api/corrections/route.ts");

  assert.match(page, /if \(!isRelifeLegacyTenant\(tenant\)\)/);
  assert.match(page, /listOwnTodayCorrectionEntries\(context\)/);
  assert.match(route, /requireTenantFeature\(tenant, "core\.finance_basic"\)/);
  assert.match(route, /if \(!isRelifeLegacyTenant\(tenant\)\) throw new Error\("LEGACY_CORRECTION_NOT_AVAILABLE"\)/);
});
