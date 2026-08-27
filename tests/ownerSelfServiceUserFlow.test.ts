import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { actionsForRoles, canPerform, type AccessContext } from "../lib/webos/access.ts";
import { analyzeImportRows } from "../lib/domain/tenancy/importMapping.ts";
import { buildActivationHandoff, buildImportHandoff } from "../lib/domain/tenancy/onboardingHandoff.ts";

const scope = { organizationId: "org-owner-flow", clinicId: "clinic-owner-flow" };

function context(roles: AccessContext["roles"]): AccessContext {
  return {
    staffId: "ST-OWNER-FLOW",
    roles,
    primaryDepartment: "All",
    departmentAccess: ["All"],
  };
}

test("Clinic Owner functional flow keeps System Admin and platform authority separate", () => {
  const owner = context(["Owner"]);
  const systemAdmin = context(["System Admin"]);

  assert.ok(actionsForRoles(owner.roles).includes("settings.manage"));
  assert.equal(canPerform(owner, "settings.manage", "Physio"), true);
  assert.equal(canPerform(owner, "settings.manage", "Dental"), true);

  assert.equal(canPerform(systemAdmin, "settings.manage", "All"), true);
  assert.equal(canPerform(systemAdmin, "patient.read", "Physio"), false);
  assert.equal(canPerform(systemAdmin, "cash.read", "Physio"), false);
});

test("Clinic Owner patient-import handoff is tenant-bound, non-mutating, and matches Dental/Physio rules", () => {
  const rows = [
    { name: "Dental Patient", phone: "", email: "", gender: "", department: "Dental" },
    { name: "Physio Patient", phone: "+8801712345678", email: "", gender: "Female", department: "Physio" },
  ];
  const mappings = [
    { sourceIndex: 0, sourceHeader: "name", targetField: "name" },
    { sourceIndex: 1, sourceHeader: "phone", targetField: "phone" },
    { sourceIndex: 2, sourceHeader: "email", targetField: "email" },
    { sourceIndex: 3, sourceHeader: "gender", targetField: "gender" },
    { sourceIndex: 4, sourceHeader: "department", targetField: "department" },
  ];

  const analysis = analyzeImportRows("patients", rows, mappings, 10);
  assert.equal(analysis.totalRows, 2);
  assert.equal(analysis.validRows, 2);
  assert.equal(analysis.invalidRows, 0);
  assert.equal(analysis.canProceed, true);

  const digest = createHash("sha256").update(JSON.stringify({ rows, mappings })).digest("hex");
  const handoff = buildImportHandoff(scope, {
    entityType: "patients",
    totalRows: analysis.totalRows,
    validRows: analysis.validRows,
    invalidRows: analysis.invalidRows,
    canProceed: analysis.canProceed,
    sourceDigestSha256: digest,
  });

  assert.deepEqual(handoff.scope, scope);
  assert.equal(handoff.status, "READY_FOR_PLATFORM_IMPORT_REVIEW");
  assert.equal(handoff.mutationPerformed, false);
  assert.equal(handoff.clinicOwnerMayExecuteImport, false);
});

test("Clinic Owner import blocks invalid Physio data before platform review", () => {
  const analysis = analyzeImportRows(
    "patients",
    [{ name: "Physio Missing Gender", phone: "+8801712345678", gender: "", department: "Physio" }],
    [
      { sourceIndex: 0, sourceHeader: "name", targetField: "name" },
      { sourceIndex: 1, sourceHeader: "phone", targetField: "phone" },
      { sourceIndex: 2, sourceHeader: "gender", targetField: "gender" },
      { sourceIndex: 3, sourceHeader: "department", targetField: "department" },
    ],
  );
  assert.equal(analysis.canProceed, false);
  assert.equal(analysis.invalidRows, 1);

  const handoff = buildImportHandoff(scope, {
    entityType: "patients",
    totalRows: analysis.totalRows,
    validRows: analysis.validRows,
    invalidRows: analysis.invalidRows,
    canProceed: analysis.canProceed,
    sourceDigestSha256: createHash("sha256").update("invalid-physio-row").digest("hex"),
  });
  assert.equal(handoff.status, "BLOCKED_INVALID_IMPORT");
  assert.equal(handoff.mutationPerformed, false);
});

test("Owner readiness hands off to platform verification without browser activation authority", () => {
  const ready = buildActivationHandoff(scope, "READY_FOR_ACTIVATION");
  assert.deepEqual(ready.scope, scope);
  assert.equal(ready.status, "READY_FOR_PLATFORM_VERIFICATION");
  assert.equal(ready.clinicOwnerAuthority, "TENANT_CONFIGURATION_ONLY");
  assert.equal(ready.platformOperatorIsBrowserRole, false);
  assert.equal(ready.systemAdminIsPlatformOperator, false);
  assert.equal(ready.browserMayRecordReadinessEvidence, false);
  assert.equal(ready.browserMayActivate, false);
  assert.equal(ready.browserMayAssignEntitlements, false);
  assert.equal(ready.requiresExactReleaseShaEvidence, true);
  assert.equal(ready.mutationPerformed, false);

  const blocked = buildActivationHandoff(scope, "NOT_READY");
  assert.equal(blocked.status, "BLOCKED_OWNER_CONFIGURATION");
  assert.equal(blocked.browserMayActivate, false);
});
