import test from "node:test";
import assert from "node:assert/strict";
import {
  canPerform,
  type AccessContext,
  type WebAction,
  type WebRole,
} from "../lib/webos/access.ts";

function context(
  roles: WebRole[],
  departmentAccess: AccessContext["departmentAccess"],
  primaryDepartment: AccessContext["primaryDepartment"]
): AccessContext {
  return { staffId: "QA-STAFF", roles, departmentAccess, primaryDepartment };
}

function expectAllowed(ctx: AccessContext, department: "Physio" | "Dental" | "All", actions: WebAction[]): void {
  for (const action of actions) {
    assert.equal(canPerform(ctx, action, department), true, `${ctx.roles.join("+")} should allow ${action} in ${department}`);
  }
}

function expectDenied(ctx: AccessContext, department: "Physio" | "Dental" | "All", actions: WebAction[]): void {
  for (const action of actions) {
    assert.equal(canPerform(ctx, action, department), false, `${ctx.roles.join("+")} should deny ${action} in ${department}`);
  }
}

const WORKFORCE_ACTIONS: WebAction[] = [
  "shift.read",
  "shift.manage",
  "leave.read",
  "leave.request",
  "leave.decide",
  "leave.cancel",
  "leave.cancel_own",
];

test("Owner has every workforce action in both departments", () => {
  expectAllowed(context(["Owner"], ["All"], "All"), "Physio", WORKFORCE_ACTIONS);
  expectAllowed(context(["Owner"], ["All"], "All"), "Dental", WORKFORCE_ACTIONS);
});

test("Manager has department workforce actions but cannot cancel another staff member's leave", () => {
  const physioManager = context(["Manager"], ["Physio"], "Physio");
  expectAllowed(physioManager, "Physio", WORKFORCE_ACTIONS.filter((action) => action !== "leave.cancel"));
  expectDenied(physioManager, "Physio", ["leave.cancel"]);
  expectDenied(physioManager, "Dental", WORKFORCE_ACTIONS);
});

for (const role of ["Receptionist", "Therapist", "Dentist"] as WebRole[]) {
  test(`${role} may read/request/cancel own leave and read shifts, but never manage shifts or decide leave`, () => {
    const ctx = context([role], ["Physio"], "Physio");
    expectAllowed(ctx, "Physio", ["shift.read", "leave.read", "leave.request", "leave.cancel_own"]);
    expectDenied(ctx, "Physio", ["shift.manage", "leave.decide", "leave.cancel"]);
  });
}

test("Auditor may only read shifts/leave; never manage, request, cancel, or decide", () => {
  const auditor = context(["Auditor"], ["All"], "All");
  expectAllowed(auditor, "Physio", ["shift.read", "leave.read"]);
  expectDenied(auditor, "Physio", ["shift.manage", "leave.request", "leave.decide", "leave.cancel", "leave.cancel_own"]);
});

for (const role of ["Dental_Assistant", "System Admin"] as WebRole[]) {
  test(`${role} has no workforce access at all`, () => {
    const ctx = context([role], ["Dental"], "Dental");
    expectDenied(ctx, "Dental", WORKFORCE_ACTIONS);
  });
}

test("workforce actions are patient/appointment/payment/clinical/chamber scoped like other department actions: All-department records are denied for the mutation actions", () => {
  // shift.manage/leave.request/leave.decide/leave.cancel_own are not
  // patient-scoped actions in isPatientScopedAction(), but canAccessDepartment
  // still requires the actor's own departmentAccess to include the record's
  // department (or "All"); a caller with no department mapping is denied.
  const noDeptMapping: AccessContext = { staffId: "X", roles: ["Owner"], departmentAccess: [], primaryDepartment: "All" };
  expectDenied(noDeptMapping, "Physio", WORKFORCE_ACTIONS);
});
