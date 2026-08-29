import "server-only";

import { hasTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { resolveStaffTenantContext } from "@/lib/domain/tenancy/staffTenantContext";
import type { Scope } from "@/lib/types";
import {
  canPerform,
  type AccessContext,
  type WebAction,
} from "@/lib/webos/access";
import {
  getAppointmentsForContext,
  todayDhaka,
  type AppointmentRecord,
} from "@/lib/webos/reception";
import { listTenantScopedWebStaffDirectory } from "@/lib/webos/tenantStaffDirectory";

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
    cashRequest: boolean;
    attendanceSelf: boolean;
    inventoryRead: boolean;
    chamberRead: boolean;
    chamberRun: boolean;
    liveChat: boolean;
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

  const tenant = await resolveStaffTenantContext(context.staffId);
  if (!tenant?.organizationId || !tenant?.clinicId) throw new Error("ACCESS_DENIED");
  const date = todayDhaka();
  const [appointments, directory, patientsEnabled, appointmentsEnabled, financeEnabled, advancedFinanceEnabled, attendanceEnabled, inventoryEnabled, chamberEnabled, liveChatEnabled] = await Promise.all([
    getAppointmentsForContext(context, scope, date, tenant.organizationId, tenant.clinicId),
    isClinician(role) ? listTenantScopedWebStaffDirectory(tenant) : Promise.resolve([]),
    hasTenantFeature(tenant, "core.patients"),
    hasTenantFeature(tenant, "core.appointments"),
    hasTenantFeature(tenant, "core.finance_basic"),
    hasTenantFeature(tenant, "optional.finance_advanced"),
    hasTenantFeature(tenant, "optional.attendance"),
    hasTenantFeature(tenant, "optional.inventory"),
    hasTenantFeature(tenant, "optional.live_chamber"),
    hasTenantFeature(tenant, "optional.live_chat"),
  ]);

  const staffName =
    directory.find((item) => normalized(item.staffId) === normalized(context.staffId))
      ?.fullName || context.staffId;

  const visibleAppointments = isClinician(role)
    ? appointments.filter((row) =>
        belongsToCurrentClinician(row, context.staffId, staffName)
      )
    : appointments;

  const completedRows = visibleAppointments.filter(
    (row) => statusOf(row) === "completed"
  );
  const completed = completedRows.length;
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
      patientsTreated: new Set(completedRows.map((row) => row.patientId)).size,
      sessions: completed,
    },
    capabilities: {
      patientRead: patientsEnabled && canInScope(context, scope, "patient.read"),
      patientCreate: patientsEnabled && canInScope(context, scope, "patient.create"),
      appointmentRead: appointmentsEnabled && canInScope(context, scope, "appointment.read"),
      appointmentCreate: appointmentsEnabled && canInScope(context, scope, "appointment.create"),
      paymentCreate: financeEnabled && canInScope(context, scope, "payment.create"),
      registerRead: patientsEnabled && canInScope(context, scope, "register.read"),
      expenseRequest: financeEnabled && canInScope(context, scope, "expense.request"),
      cashRead: advancedFinanceEnabled && canInScope(context, scope, "cash.read"),
      cashRequest: advancedFinanceEnabled && canInScope(context, scope, "cash.request"),
      attendanceSelf: attendanceEnabled && canInScope(context, scope, "attendance.self"),
      inventoryRead: inventoryEnabled && canInScope(context, scope, "inventory.read"),
      chamberRead: chamberEnabled && canInScope(context, scope, "chamber.read"),
      chamberRun: chamberEnabled && canInScope(context, scope, "chamber.run"),
      liveChat: liveChatEnabled && canInScope(context, scope, "chamber.read"),
    },
  };
}
