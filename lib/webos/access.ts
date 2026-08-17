import type { Department } from "@/lib/types";

export type WebRole =
  | "Owner"
  | "Manager"
  | "Receptionist"
  | "Therapist"
  | "Dentist"
  | "Dental_Assistant"
  | "Auditor"
  | "System Admin";

export type WebAction =
  | "patient.read"
  | "patient.create"
  | "patient.update"
  | "patient.report.read"
  | "patient.report.upload"
  | "appointment.read"
  | "appointment.create"
  | "appointment.update"
  | "register.read"
  | "payment.read_amount"
  | "payment.create"
  | "payment.void"
  | "payment.correct_own_today"
  | "report.read_operational"
  | "report.read_financial"
  | "expense.read"
  | "expense.request"
  | "expense.approve"
  | "expense.pay"
  | "cash.read"
  | "cash.request"
  | "cash.accept"
  | "salary.read"
  | "salary.pay"
  | "attendance.self"
  | "attendance.read_team"
  | "clinical.read"
  | "clinical.write"
  | "clinical.clearance_read"
  | "inventory.read"
  | "inventory.write"
  | "chamber.read"
  | "chamber.receive"
  | "chamber.run"
  | "audit.read"
  | "settings.manage";

export interface AccessContext {
  staffId: string;
  roles: WebRole[];
  primaryDepartment: Department;
  /** Explicit authorization scope. Never infer All from a missing value. */
  departmentAccess: Department[];
  /** Live 08_Staff policy flags; optional for owner/system compatibility. */
  clinicalWriteScope?: string;
  financialAccess?: string;
}

export interface AccessConditions {
  /** Required for Therapist/Dentist clinical writes. */
  assignedToCurrentStaff?: boolean;
  /** Explicit, date-bound cross-cover can substitute for direct assignment. */
  currentDayCrossCover?: boolean;
}

const ROLE_ACTIONS: Record<WebRole, ReadonlySet<WebAction>> = {
  Owner: new Set<WebAction>([
    "patient.read",
    "patient.create",
    "patient.update",
    "patient.report.read",
    "patient.report.upload",
    "appointment.read",
    "appointment.create",
    "appointment.update",
    "register.read",
    "payment.read_amount",
    "payment.create",
    "payment.void",
    "payment.correct_own_today",
    "report.read_operational",
    "report.read_financial",
    "expense.read",
    "expense.request",
    "expense.approve",
    "expense.pay",
    "cash.read",
    "cash.request",
    "cash.accept",
    "salary.read",
    "salary.pay",
    "attendance.self",
    "attendance.read_team",
    "clinical.read",
    "clinical.write",
    "clinical.clearance_read",
    "inventory.read",
    "inventory.write",
    "chamber.read",
    "chamber.receive",
    "chamber.run",
    "audit.read",
    "settings.manage",
  ]),
  Manager: new Set<WebAction>([
    "patient.read",
    "patient.create",
    "patient.update",
    "patient.report.read",
    "appointment.read",
    "appointment.create",
    "appointment.update",
    "register.read",
    "payment.read_amount",
    "payment.create",
    "payment.correct_own_today",
    "report.read_operational",
    "expense.read",
    "expense.request",
    "cash.read",
    "cash.accept",
    "attendance.self",
    "attendance.read_team",
    "clinical.read",
    "clinical.clearance_read",
    "inventory.read",
    "inventory.write",
    "chamber.read",
    "chamber.receive",
    "chamber.run",
  ]),
  Receptionist: new Set<WebAction>([
    "patient.read",
    "patient.create",
    "patient.update",
    "patient.report.read",
    "patient.report.upload",
    "appointment.read",
    "appointment.create",
    "appointment.update",
    "register.read",
    "payment.read_amount",
    "payment.create",
    "payment.correct_own_today",
    "report.read_operational",
    "expense.request",
    "expense.pay",
    "cash.read",
    "cash.request",
    "attendance.self",
    "inventory.read",
    "inventory.write",
    "chamber.read",
    "chamber.receive",
  ]),
  Therapist: new Set<WebAction>([
    "patient.read",
    "patient.report.read",
    "patient.report.upload",
    "appointment.read",
    "appointment.create",
    "register.read",
    "attendance.self",
    "clinical.read",
    "clinical.write",
    "clinical.clearance_read",
    "inventory.read",
    "chamber.read",
    "chamber.run",
  ]),
  Dentist: new Set<WebAction>([
    "patient.read",
    "patient.report.read",
    "patient.report.upload",
    "appointment.read",
    "appointment.create",
    "register.read",
    "attendance.self",
    "clinical.read",
    "clinical.write",
    "clinical.clearance_read",
    "inventory.read",
  ]),
  // Final production capabilities for this role remain deliberately empty
  // until an explicit Dental Assistant allowlist is reviewed and tested.
  Dental_Assistant: new Set<WebAction>([]),
  Auditor: new Set<WebAction>([
    "register.read",
    "report.read_operational",
    "report.read_financial",
    "expense.read",
    "cash.read",
    "salary.read",
    "attendance.read_team",
    "audit.read",
  ]),
  // System Admin is not a clinical role and receives no implicit patient data.
  "System Admin": new Set<WebAction>(["settings.manage"]),
};

function uniqueKnownDepartments(values: Department[]): Department[] {
  return [...new Set(values.filter((value) => ["Physio", "Dental", "All"].includes(value)))];
}

export function canAccessDepartment(
  context: AccessContext,
  recordDepartment: Department
): boolean {
  if (!context.staffId.trim() || context.roles.length === 0) return false;
  const access = uniqueKnownDepartments(context.departmentAccess);
  if (access.length === 0) return false;
  if (access.includes("All")) return true;
  if (recordDepartment === "All") return false;
  return access.includes(recordDepartment);
}

function isPatientScopedAction(action: WebAction): boolean {
  return action.startsWith("patient.") ||
         action.startsWith("appointment.") ||
         action.startsWith("payment.") ||
         action.startsWith("clinical.") ||
         action.startsWith("chamber.");
}

function roleAllows(roles: WebRole[], action: WebAction): boolean {
  return roles.some((role) => ROLE_ACTIONS[role]?.has(action));
}

function hasTemporaryDentalDataEntry(context: AccessContext): boolean {
  const departments = uniqueKnownDepartments(context.departmentAccess);
  return Boolean(
    context.roles.includes("Receptionist") &&
      context.clinicalWriteScope?.trim() === "Dental_Temporary_Data_Entry" &&
      departments.length === 1 &&
      departments[0] === "Dental" &&
      context.primaryDepartment === "Dental"
  );
}

export function canPerform(
  context: AccessContext,
  action: WebAction,
  recordDepartment: Department,
  conditions: AccessConditions = {}
): boolean {
  if (!canAccessDepartment(context, recordDepartment)) return false;

  // Patient-scoped actions cannot operate on records with department="All"
  // (patients always have Physio or Dental, never All)
  if (recordDepartment === "All" && isPatientScopedAction(action)) return false;

  // Production Telegram parity: an explicitly provisioned Dental-only
  // Receptionist may temporarily read and enter Dental clinical data. This is
  // NOT a general Receptionist permission and fails closed for All/mixed/Physio.
  if (
    (action === "clinical.read" || action === "clinical.write") &&
    recordDepartment === "Dental" &&
    hasTemporaryDentalDataEntry(context)
  ) {
    return true;
  }

  if (!roleAllows(context.roles, action)) return false;

  if (action === "clinical.write") {
    if (context.roles.includes("Owner")) return true;
    const isClinician =
      context.roles.includes("Therapist") || context.roles.includes("Dentist");
    if (!isClinician) return false;
    return Boolean(
      conditions.assignedToCurrentStaff || conditions.currentDayCrossCover
    );
  }

  return true;
}

export function assertCanPerform(
  context: AccessContext,
  action: WebAction,
  recordDepartment: Department,
  conditions: AccessConditions = {}
): void {
  if (!canPerform(context, action, recordDepartment, conditions)) {
    throw new Error("ACCESS_DENIED");
  }
}

export function actionsForRoles(roles: WebRole[]): WebAction[] {
  const actions = new Set<WebAction>();
  for (const role of roles) {
    for (const action of ROLE_ACTIONS[role] ?? []) actions.add(action);
  }
  return [...actions];
}
