import test from "node:test";
import assert from "node:assert/strict";
import {
  actionsForRoles,
  canAccessDepartment,
  canPerform,
  type AccessContext,
  type WebAction,
  type WebRole,
} from "../lib/webos/access.ts";

function context(
  roles: WebRole[],
  departmentAccess: AccessContext["departmentAccess"],
  primaryDepartment: AccessContext["primaryDepartment"],
  overrides: Partial<AccessContext> = {}
): AccessContext {
  return {
    staffId: "QA-STAFF",
    roles,
    departmentAccess,
    primaryDepartment,
    ...overrides,
  };
}

function expectAllowed(
  ctx: AccessContext,
  department: "Physio" | "Dental" | "All",
  actions: WebAction[]
): void {
  for (const action of actions) {
    assert.equal(
      canPerform(ctx, action, department),
      true,
      `${ctx.roles.join("+")} should allow ${action} in ${department}`
    );
  }
}

function expectDenied(
  ctx: AccessContext,
  department: "Physio" | "Dental" | "All",
  actions: WebAction[]
): void {
  for (const action of actions) {
    assert.equal(
      canPerform(ctx, action, department),
      false,
      `${ctx.roles.join("+")} should deny ${action} in ${department}`
    );
  }
}

test("Receptionist workflow permissions match clinic operations", () => {
  const ctx = context(["Receptionist"], ["Physio"], "Physio");
  expectAllowed(ctx, "Physio", [
    "patient.read",
    "patient.create",
    "patient.update",
    "appointment.read",
    "appointment.create",
    "appointment.update",
    "payment.read_amount",
    "payment.create",
    "expense.request",
    "cash.read",
    "cash.request",
    "chamber.read",
    "chamber.receive",
  ]);
  expectDenied(ctx, "Physio", [
    "expense.approve",
    "cash.accept",
    "salary.read",
    "salary.pay",
    "clinical.write",
    "chamber.run",
    "audit.read",
  ]);
});

test("Therapist is clinical/Chamber-run only and clinical write requires assignment or cross-cover", () => {
  const ctx = context(["Therapist"], ["Physio"], "Physio");
  expectAllowed(ctx, "Physio", [
    "patient.read",
    "appointment.read",
    "appointment.create",
    "clinical.read",
    "chamber.read",
    "chamber.run",
  ]);
  assert.equal(canPerform(ctx, "clinical.write", "Physio"), false);
  assert.equal(
    canPerform(ctx, "clinical.write", "Physio", { assignedToCurrentStaff: true }),
    true
  );
  assert.equal(
    canPerform(ctx, "clinical.write", "Physio", { currentDayCrossCover: true }),
    true
  );
  expectDenied(ctx, "Physio", [
    "payment.create",
    "expense.request",
    "cash.read",
    "cash.request",
    "cash.accept",
    "salary.read",
    "salary.pay",
    "chamber.receive",
  ]);
  assert.equal(canAccessDepartment(ctx, "Dental"), false);
});

test("Dentist is Dental scoped and cannot cross into Physio", () => {
  const ctx = context(["Dentist"], ["Dental"], "Dental");
  expectAllowed(ctx, "Dental", [
    "patient.read",
    "appointment.read",
    "appointment.create",
    "clinical.read",
  ]);
  assert.equal(
    canPerform(ctx, "clinical.write", "Dental", { assignedToCurrentStaff: true }),
    true
  );
  assert.equal(canAccessDepartment(ctx, "Physio"), false);
  expectDenied(ctx, "Dental", [
    "payment.create",
    "cash.read",
    "salary.read",
    "chamber.run",
  ]);
});

test("Manager keeps operational cash acceptance but not owner finance powers", () => {
  const ctx = context(["Manager"], ["Physio"], "Physio");
  expectAllowed(ctx, "Physio", [
    "patient.read",
    "patient.create",
    "appointment.create",
    "expense.read",
    "expense.request",
    "cash.read",
    "cash.accept",
    "attendance.read_team",
    "chamber.receive",
    "chamber.run",
  ]);
  expectDenied(ctx, "Physio", [
    "payment.create",
    "expense.approve",
    "salary.read",
    "salary.pay",
    "report.read_financial",
  ]);
});

test("Auditor is finance/report read-only", () => {
  const ctx = context(["Auditor"], ["All"], "All");
  expectAllowed(ctx, "Physio", [
    "register.read",
    "report.read_operational",
    "report.read_financial",
    "expense.read",
    "cash.read",
    "salary.read",
    "audit.read",
  ]);
  expectDenied(ctx, "Physio", [
    "patient.create",
    "appointment.create",
    "payment.create",
    "expense.request",
    "expense.approve",
    "cash.request",
    "cash.accept",
    "salary.pay",
    "clinical.write",
    "chamber.run",
  ]);
});

test("Owner retains full operational and finance access", () => {
  const ctx = context(["Owner"], ["All"], "All");
  const actions = actionsForRoles(["Owner"]);
  assert.ok(actions.length >= 35, "Owner action set unexpectedly shrank");
  for (const action of actions) {
    assert.equal(canPerform(ctx, action, "Physio", { assignedToCurrentStaff: false }), true);
    assert.equal(canPerform(ctx, action, "Dental", { assignedToCurrentStaff: false }), true);
  }
});

test("Dental temporary data-entry scope is exact and fails closed outside Dental", () => {
  const temp = context(["Receptionist"], ["Dental"], "Dental", {
    clinicalWriteScope: "Dental_Temporary_Data_Entry",
  });
  assert.equal(canPerform(temp, "clinical.read", "Dental"), true);
  assert.equal(canPerform(temp, "clinical.write", "Dental"), true);
  assert.equal(canPerform(temp, "clinical.write", "Physio"), false);

  const mixed = context(["Receptionist"], ["Dental", "Physio"], "Dental", {
    clinicalWriteScope: "Dental_Temporary_Data_Entry",
  });
  assert.equal(canPerform(mixed, "clinical.write", "Dental"), false);

  const wrongPrimary = context(["Receptionist"], ["Dental"], "Physio", {
    clinicalWriteScope: "Dental_Temporary_Data_Entry",
  });
  assert.equal(canPerform(wrongPrimary, "clinical.write", "Dental"), false);
});

test("Missing department mapping always fails closed", () => {
  const ctx = context(["Owner"], [], "All");
  assert.equal(canAccessDepartment(ctx, "Physio"), false);
  assert.equal(canPerform(ctx, "patient.read", "Physio"), false);
});
