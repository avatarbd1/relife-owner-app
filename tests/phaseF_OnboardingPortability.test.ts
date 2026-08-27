import test from "node:test";
import assert from "node:assert/strict";
import { evaluateClinicReadiness, readinessPass } from "../lib/domain/tenancy/readinessEngine.ts";
import { analyzeImportRows, buildImportPreview, validateColumnMappings, validateImportSession, validateAppointmentRow, validatePatientRow } from "../lib/domain/tenancy/importMapping.ts";
import { buildProvisioningDryRun } from "../lib/domain/tenancy/provisioningPlan.ts";

function validSnapshot() {
  return {
    scope: { organizationId: "org-1", clinicId: "clinic-1" },
    profile: {
      organizationId: "org-1", clinicId: "clinic-1", clinicName: "Test Clinic", clinicType: "physiotherapy" as const,
      branchName: "", address: "", phone: "", email: "", logoUrl: "", currency: "BDT", locale: "en",
      timezone: "Asia/Dhaka", lifecycle: "ready",
    },
    operatingHours: Array.from({ length: 7 }, (_, index) => ({
      organizationId: "org-1", clinicId: "clinic-1", dayOfWeek: index + 1, isOpen: index < 5,
      opensAt: index < 5 ? "09:00" : null, closesAt: index < 5 ? "17:00" : null,
    })),
    catalog: [{ featureKey: "core.finance_basic", status: "active" as const }],
    flags: [{ organizationId: "org-1", clinicId: "clinic-1", featureKey: "core.finance_basic", enabled: true }],
    entitlements: [{ organizationId: "org-1", clinicId: "clinic-1", featureKey: "core.finance_basic", status: "active" as const, effectiveFrom: new Date("2026-01-01"), effectiveUntil: null }],
    services: [{
      organizationId: "org-1", clinicId: "clinic-1", serviceCode: "SVC-1", displayName: "Consultation", department: "Physio" as const,
      price: 500, durationMin: 30, requiresBooking: true, requiresProvider: true, requiresResource: false,
      discountApplicable: true, taxApplicable: false, packageEligible: false, isActive: true,
    }],
    booking: {
      organizationId: "org-1", clinicId: "clinic-1", bookingMode: "simple" as const, defaultDurationMin: 30,
      slotIntervalMin: 30, maxSimultaneous: null, providerRequired: true, resourceRequired: false,
      blockDuplicatePatientOverlap: true, allowWalkIn: true, cancellationNoticeMin: 0, lateArrivalGraceMin: 0, capacityRules: {},
    },
  };
}

test("F3 readiness fails closed on missing tenant scope", async () => {
  const report = await evaluateClinicReadiness(
    { organizationId: undefined, clinicId: undefined },
    { scope: { organizationId: "", clinicId: "" }, profile: null, operatingHours: [], catalog: [], flags: [], entitlements: [], services: [] },
    [],
    null,
  );
  assert.equal(report.overallStatus, "NOT_READY");
  assert.equal(report.checks.tenantContextResolvable.status, "FAIL");
});

test("F3 readiness remains NOT_READY when trusted evidence is missing", async () => {
  const report = await evaluateClinicReadiness(
    { organizationId: "org-1", clinicId: "clinic-1" },
    validSnapshot(),
    [{ organizationId: "org-1", clinicId: "clinic-1", staffId: "staff-1", roleCodes: ["owner"] }],
    "staff-1",
  );
  assert.equal(report.overallStatus, "NOT_READY");
  assert.equal(report.checks.databaseSchemaReady.status, "UNVERIFIED");
  assert.equal(report.checks.noRelifeDefaultsInActivePath.status, "UNVERIFIED");
});

test("F3 readiness becomes ready only when all trusted evidence passes", async () => {
  const pass = readinessPass(["verified by trusted collector"]);
  const report = await evaluateClinicReadiness(
    { organizationId: "org-1", clinicId: "clinic-1" },
    validSnapshot(),
    [{ organizationId: "org-1", clinicId: "clinic-1", staffId: "staff-1", roleCodes: ["owner"] }],
    "staff-1",
    {
      organizationExists: pass,
      clinicExists: pass,
      clinicBelongsToOrganization: pass,
      databaseSchemaReady: pass,
      noRelifeDefaultsInActivePath: pass,
      crossTenantIsolationVerified: pass,
      provisioningRollbackEvidencePresent: pass,
    },
  );
  assert.equal(report.overallStatus, "READY_FOR_ACTIVATION");
});

test("F3 readiness rejects cross-tenant configuration rows", async () => {
  const snapshot = validSnapshot();
  snapshot.operatingHours[0] = { ...snapshot.operatingHours[0], organizationId: "org-2" };
  const report = await evaluateClinicReadiness(
    { organizationId: "org-1", clinicId: "clinic-1" },
    snapshot,
    [{ organizationId: "org-1", clinicId: "clinic-1", staffId: "staff-1", roleCodes: ["owner"] }],
    "staff-1",
  );
  assert.equal(report.checks.tenantSafeConfigurationLookup.status, "FAIL");
});

test("F2 patient and appointment validation reject malformed required data", () => {
  assert.equal(validatePatientRow({ name: "", phone: "123", department: "Physio", gender: "" }).valid, false);
  assert.equal(validateAppointmentRow({ patientId: "P-1", date: "2026-02-31", time: "25:99" }).valid, false);
});

test("F2 patient validation matches canonical department, Dental phone, and Physio gender rules", () => {
  assert.equal(validatePatientRow({ name: "Dental Patient", department: "Dental", phone: "", gender: "" }).valid, true);
  assert.equal(validatePatientRow({ name: "Dental Patient", department: "Dental", phone: "123", gender: "" }).valid, false);
  assert.equal(validatePatientRow({ name: "Physio Patient", department: "Physio", phone: "", gender: "" }).valid, false);
  assert.equal(validatePatientRow({ name: "Physio Patient", department: "Physio", phone: "", gender: "Female" }).valid, true);
  assert.equal(validatePatientRow({ name: "Patient", department: "Other", phone: "", gender: "Male" }).valid, false);
});

test("F2 full import analysis blocks invalid rows outside preview window", () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({
    name: `Patient ${index}`,
    phone: index === 10 ? "123" : "+8801234567890",
    department: "Physio",
    gender: "Male",
  }));
  const mappings = [
    { sourceIndex: 0, sourceHeader: "name", targetField: "name" },
    { sourceIndex: 1, sourceHeader: "phone", targetField: "phone" },
    { sourceIndex: 2, sourceHeader: "department", targetField: "department" },
    { sourceIndex: 3, sourceHeader: "gender", targetField: "gender" },
  ];
  const analysis = analyzeImportRows("patients", rows, mappings, 10);
  assert.equal(analysis.preview.length, 10);
  assert.equal(analysis.invalidRows, 1);
  assert.equal(analysis.canProceed, false);
});

test("F2 duplicate and unsupported mappings fail closed", () => {
  const issues = validateColumnMappings("patients", [
    { sourceIndex: 0, sourceHeader: "Name", targetField: "name" },
    { sourceIndex: 1, sourceHeader: "Phone", targetField: "name" },
    { sourceIndex: 2, sourceHeader: "Other", targetField: "unsafeField" },
  ], ["Name", "Phone", "Other"]);
  assert.ok(issues.some((issue) => issue.includes("duplicate target mapping")));
  assert.ok(issues.some((issue) => issue.includes("unsupported target field")));
});

test("F2 preview preserves mapped row numbers and tenant session rejects mismatch", () => {
  const preview = buildImportPreview("patients", [{ name: "John", phone: "+8801234567890", department: "Physio", gender: "Male" }], [
    { sourceIndex: 0, sourceHeader: "name", targetField: "name" },
    { sourceIndex: 1, sourceHeader: "phone", targetField: "phone" },
    { sourceIndex: 2, sourceHeader: "department", targetField: "department" },
    { sourceIndex: 3, sourceHeader: "gender", targetField: "gender" },
  ]);
  assert.equal(preview[0].rowNumber, 2);
  const errors = validateImportSession({ organizationId: "org-1", clinicId: "clinic-1" }, {
    organizationId: "org-2", clinicId: "clinic-2", entityType: "patients", sessionId: "s1", uploadedAt: new Date(),
    rowCount: 1, mappings: [], status: "mapping", validationErrors: [],
  });
  assert.ok(errors.includes("TENANT_SCOPE_MISMATCH"));
});

test("F5 provisioning dry-run is non-mutating and compensates each mutating step", () => {
  const dryRun = buildProvisioningDryRun({ organizationId: "org-1", clinicId: "clinic-1" }, validSnapshot());
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.reversible, true);
  assert.ok(dryRun.steps.filter((step) => step.mutates).every((step) => Boolean(step.compensation)));
});
