import test from "node:test";
import assert from "node:assert/strict";
import {
  actionsForRoles,
  canAccessDepartment,
  canPerform,
  type AccessContext,
  type WebAction,
  type WebRole,
} from "@/lib/webos/access";

function context(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    staffId: "ST001",
    roles: ["Owner"],
    primaryDepartment: "All",
    departmentAccess: ["All"],
    ...overrides,
  };
}

const roles: WebRole[] = [
  "Owner",
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
  "Dental_Assistant",
  "Auditor",
  "System Admin",
];

const declaredActions: WebAction[] = [
  "patient.read","patient.create","patient.update","patient.report.read","patient.report.upload",
  "appointment.read","appointment.create","appointment.update","register.read","payment.read_amount",
  "payment.create","payment.void","payment.correct_own_today","report.read_operational","report.read_financial",
  "expense.read","expense.request","expense.approve","expense.pay","cash.read","cash.request","cash.accept",
  "salary.read","salary.pay","attendance.self","attendance.read_team","performance.read_self",
  "performance.read_leaderboard","performance.read_team","performance.weekly.finalize","clinical.read",
  "clinical.write","clinical.clearance_read","inventory.read","inventory.write","chamber.read","chamber.receive",
  "chamber.run","audit.read","settings.manage","shift.read","shift.manage","leave.read","leave.request",
  "leave.decide","leave.cancel","leave.cancel_own",
];

test("every declared action is granted by at least one role and no role exposes an undeclared action", () => {
  const granted = new Set(actionsForRoles(roles));
  assert.deepEqual([...declaredActions].filter((action) => !granted.has(action)), []);
  assert.deepEqual([...granted].filter((action) => !declaredActions.includes(action)), []);
});

test("department access fails closed and does not treat record Department=All as patient scope", () => {
  assert.equal(canAccessDepartment(context({ roles: ["Therapist"], primaryDepartment: "Physio", departmentAccess: ["Physio"] }), "Dental"), false);
  assert.equal(canAccessDepartment(context({ roles: ["Therapist"], primaryDepartment: "Physio", departmentAccess: ["Physio"] }), "Physio"), true);
  assert.equal(canAccessDepartment(context({ staffId: "", roles: ["Owner"], departmentAccess: ["All"] }), "Dental"), false);
  assert.equal(canAccessDepartment(context({ roles: [], departmentAccess: ["All"] }), "Dental"), false);
  assert.equal(canAccessDepartment(context({ roles: ["Owner"], departmentAccess: [] }), "Dental"), false);
  assert.equal(canPerform(context(), "patient.read", "All"), false);
  assert.equal(canPerform(context(), "inventory.read", "All"), true);
});

test("clinical.write requires assignment or current-day cross-cover for clinicians", () => {
  const therapist = context({ roles: ["Therapist"], primaryDepartment: "Physio", departmentAccess: ["Physio"] });
  assert.equal(canPerform(therapist, "clinical.write", "Physio"), false);
  assert.equal(canPerform(therapist, "clinical.write", "Physio", { assignedToCurrentStaff: true }), true);
  assert.equal(canPerform(therapist, "clinical.write", "Physio", { currentDayCrossCover: true }), true);
  assert.equal(canPerform(context(), "clinical.write", "Physio"), true);
  assert.equal(canPerform(context({ roles: ["Manager"], primaryDepartment: "Physio", departmentAccess: ["Physio"] }), "clinical.write", "Physio", { assignedToCurrentStaff: true }), false);
});

test("temporary Dental Receptionist clinical exception fails closed outside exact provisioning", () => {
  const dentalTemp = context({
    roles: ["Receptionist"],
    primaryDepartment: "Dental",
    departmentAccess: ["Dental"],
    clinicalWriteScope: "Dental_Temporary_Data_Entry",
  });
  assert.equal(canPerform(dentalTemp, "clinical.write", "Dental"), true);
  assert.equal(canPerform({ ...dentalTemp, departmentAccess: ["Dental", "Physio"] }, "clinical.write", "Dental"), false);
  assert.equal(canPerform({ ...dentalTemp, departmentAccess: ["All"] }, "clinical.write", "Dental"), false);
  assert.equal(canPerform({ ...dentalTemp, primaryDepartment: "Physio" }, "clinical.write", "Dental"), false);
  assert.equal(canPerform({ ...dentalTemp, clinicalWriteScope: undefined }, "clinical.write", "Dental"), false);
  assert.equal(canPerform(dentalTemp, "clinical.write", "Physio"), false);
});

test("Dental Assistant remains deny-all and System Admin remains settings-only", () => {
  const assistant = context({ roles: ["Dental_Assistant"], primaryDepartment: "Dental", departmentAccess: ["Dental"] });
  assert.equal(actionsForRoles(["Dental_Assistant"]).length, 0);
  assert.equal(canPerform(assistant, "patient.read", "Dental"), false);

  const sysadmin = context({ roles: ["System Admin"], primaryDepartment: "All", departmentAccess: ["All"] });
  assert.equal(canPerform(sysadmin, "settings.manage", "All"), true);
  assert.equal(canPerform(sysadmin, "patient.read", "Physio"), false);
});
