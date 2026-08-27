import test from "node:test";
import assert from "node:assert/strict";
import type { ClinicConfigurationSnapshot } from "../lib/domain/tenancy/configurationCore.ts";
import { resolveFinanceConfiguration, resolveStaffProvisioning, staffFinanceReadiness, type StaffProvisioningConfiguration } from "../lib/domain/tenancy/staffFinanceConfiguration.ts";

const A = { organizationId: "11111111-1111-4111-8111-111111111111", clinicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const B = { organizationId: "22222222-2222-4222-8222-222222222222", clinicId: A.clinicId };
const at = new Date("2026-08-27T12:00:00Z");
const snapshot = (features: string[]): ClinicConfigurationSnapshot => ({
  scope: A,
  profile: { ...A, clinicName: "Clinic A", clinicType: "physiotherapy", branchName: "Main", address: "Address", phone: "01234567890", email: "", logoUrl: "", currency: "BDT", locale: "bn-BD", timezone: "Asia/Dhaka", lifecycle: "active" },
  operatingHours: [], services: [],
  catalog: ["core.finance_basic", "optional.salary", "optional.finance_advanced"].map((featureKey) => ({ featureKey, status: "active" })),
  flags: features.map((featureKey) => ({ ...A, featureKey, enabled: true })),
  entitlements: features.map((featureKey) => ({ ...A, featureKey, status: "active", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: null })),
});
const staff = (extra: Partial<StaffProvisioningConfiguration> = {}): StaffProvisioningConfiguration => ({ ...A, staffId: "STF-1", roleCodes: ["owner"], departmentIds: ["All"], status: "active", salaryAmount: null, appointmentProvider: false, loginEnabled: true, ...extra });
const failureReason = (result: { ok: true } | { ok: false; reason: string }) => result.ok ? "ok" : result.reason;

test("valid tenant-scoped owner provisioning resolves", () => assert.equal(resolveStaffProvisioning(A, staff()).ok, true));
test("missing and partial tenant identity fail closed", () => {
  assert.equal(failureReason(resolveStaffProvisioning({ organizationId: "", clinicId: A.clinicId }, staff())), "not_authorized");
  assert.equal(failureReason(resolveStaffProvisioning({ organizationId: A.organizationId, clinicId: "" }, staff())), "not_authorized");
});
test("same clinic id in another organization cannot cross-match", () => assert.equal(failureReason(resolveStaffProvisioning(A, staff(B))), "not_authorized"));
test("unknown role, empty department and inactive staff are invalid", () => {
  const result = resolveStaffProvisioning(A, staff({ roleCodes: ["super-owner"], departmentIds: [], status: "inactive" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.details, ["role assignment invalid", "department assignment invalid", "staff provisioning inactive"]);
});
test("provider assignment requires a provider role", () => assert.equal(resolveStaffProvisioning(A, staff({ roleCodes: ["receptionist"], appointmentProvider: true })).ok, false));
test("basic finance is required while optional modules remain independent", () => {
  assert.equal(resolveFinanceConfiguration(A, snapshot([]), at).ok, false);
  assert.deepEqual(resolveFinanceConfiguration(A, snapshot(["core.finance_basic"]), at), { ok: true, value: { basicFinance: true, salary: false, advancedFinance: false } });
  assert.deepEqual(resolveFinanceConfiguration(A, snapshot(["core.finance_basic", "optional.salary"]), at), { ok: true, value: { basicFinance: true, salary: true, advancedFinance: false } });
});
test("cross-tenant finance snapshot is rejected", () => assert.equal(failureReason(resolveFinanceConfiguration(B, snapshot(["core.finance_basic"]), at)), "not_authorized"));
test("readiness gives explicit owner and salary reasons", () => {
  const result = staffFinanceReadiness(A, snapshot(["core.finance_basic", "optional.salary"]), [staff({ roleCodes: ["therapist"], departmentIds: ["Physio"] })], at);
  assert.equal(result.readyForPhaseDScope, false);
  assert.deepEqual(result.reasons, ["active owner provisioning missing", "salary feature requires staff salary configuration"]);
});
