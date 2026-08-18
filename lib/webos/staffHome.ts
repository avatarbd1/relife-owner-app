import "server-only";

import type { Scope } from "@/lib/types";
import {
  canPerform,
  type AccessContext,
  type WebAction,
} from "@/lib/webos/access";
import { getDailyClinicalActivity } from "@/lib/webos/dailyClinicalActivity";
import {
  getAppointmentsForContext,
  todayDhaka,
  type AppointmentRecord,
} from "@/lib/webos/reception";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

export type StaffHomeRole = "Manager" | "Receptionist" | "Therapist" | "Dentist";

type ClinicDepartment = "Physio" | "Dental";

export interface StaffHomeSnapshot {
  date: string;
  scope: Scope;
  role: StaffHomeRole;
  staffName: string;
  appointments: AppointmentRecord[];
  counts: {
    appointments: number;
    open: number;
    ready: number;
    completed: number;
    exceptions: number;
    patientsTreated: number;
    sessions: number;
  };
  capabilities: {
    patientRead: boolean;
    patientCreate: boolean;
    appointmentRead: boolean;
    appointmentCreate: boolean;
    paymentCreate: boolean;
    registerRead: boolean;
    expenseRequest: boolean;
    cashRead: boolean;
    attendanceSelf: boolean;
    inventoryRead: boolean;
    chamberRead: boolean;
    chamberRun: boolean;
  };
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function departmentsForScope(scope: Scope): ClinicDepartment[] {
  if (scope === "physio") return ["Physio"];
  if (scope === "dental") return ["Dental"];
  return ["Physio", "Dental"];
}

function canInScope(
  context: AccessContext,
  scope: Scope,
  action: WebAction
): boolean {
  return departmentsForScope(scope).some((department) =>
    canPerform(context, action, department)
  );
}

export function resolveStaffHomeRole(context: AccessContext): StaffHomeRole | null {
  if (context.roles.includes("Therapist")) return "Therapist";
  if (context.roles.includes("Dentist")) return "Dentist";
  if (context.roles.includes("Receptionist")) return "Receptionist";
  if (context.roles.includes("Manager")) return "Manager";
  return null;
}

function isClinician(role: StaffHomeRole): boolean {
  return role === "Therapist" || role === "Dentist";
}

function belongsToCurrentClinician(
  appointment: AppointmentRecord,
  staffId: string,
  staffName: string
): boolean {
  const assigned = normalized(appointment.therapist);
  if (!assigned) return false;
  const aliases = new Set([normalized(staffId), normalized(staffName)].filter(Boolean));
  return aliases.has(assigned);
}

function statusOf(row: AppointmentRecord): string {
  return normalized(row.status);
}

export async function getStaffHomeSnapshot(
  context: AccessContext,
  scope: Scope
): Promise<StaffHomeSnapshot> {
  const role = resolveStaffHomeRole(context);
  if (!role) throw new Error("STAFF_HOME_ROLE_UNAVAILABLE");

  const date = todayDhaka();
  const [appointments, clinicalActivity, directory] = await Promise.all([
    getAppointmentsForContext(context, scope, date),
    getDailyClinicalActivity(scope, date),
    isClinician(role) ? getWebStaffDirectory() : Promise.resolve([]),
  ]);

  const staffName =
    directory.find((item) => normalized(item.staffId) === normalized(context.staffId))
      ?.fullName || context.staffId;

  const visibleAppointments = isClinician(role)
    ? appointments.filter((row) =>
        belongsToCurrentClinician(row, context.staffId, staffName)
      )
    : appointments;

  const completed = visibleAppointments.filter(
    (row) => statusOf(row) === "completed"
  ).length;
  const exceptions = visibleAppointments.filter((row) =>
    ["no-show", "cancelled", "canceled"].includes(statusOf(row))
  ).length;
  const ready = visibleAppointments.filter((row) =>
    ["arrived", "waiting", "in treatment"].includes(statusOf(row))
  ).length;
  const open = Math.max(
    0,
    visibleAppointments.length - completed - exceptions
  );

  return {
    date,
    scope,
    role,
    staffName,
    appointments: visibleAppointments,
    counts: {
      appointments: visibleAppointments.length,
      open,
      ready,
      completed,
      exceptions,
      patientsTreated: clinicalActivity.patients,
      sessions: clinicalActivity.sessions,
    },
    capabilities: {
      patientRead: canInScope(context, scope, "patient.read"),
      patientCreate: canInScope(context, scope, "patient.create"),
      appointmentRead: canInScope(context, scope, "appointment.read"),
      appointmentCreate: canInScope(context, scope, "appointment.create"),
      paymentCreate: canInScope(context, scope, "payment.create"),
      registerRead: canInScope(context, scope, "register.read"),
      expenseRequest: canInScope(context, scope, "expense.request"),
      cashRead: canInScope(context, scope, "cash.read"),
      attendanceSelf: canInScope(context, scope, "attendance.self"),
      inventoryRead: canInScope(context, scope, "inventory.read"),
      chamberRead: canInScope(context, scope, "chamber.read"),
      chamberRun: canInScope(context, scope, "chamber.run"),
    },
  };
}
