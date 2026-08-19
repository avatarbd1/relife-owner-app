import "server-only";

import { randomUUID } from "node:crypto";
import {
  gamificationSupabaseConfigured,
  recordVerifiedGamificationEvent,
} from "@/lib/data/supabaseGamification";
import type { AccessContext } from "@/lib/webos/access";
import {
  getWebStaffDirectory,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";

type ClinicDepartment = "Physio" | "Dental";
type GamificationRoleContext =
  | "Owner"
  | "Manager"
  | "Receptionist"
  | "Therapist"
  | "Dentist";
type ActorEventPurpose = "reception" | "attendance";

export interface AppointmentCompletionGamificationInput {
  appointmentId: string;
  patientId: string;
  department: ClinicDepartment;
  therapistReference: string;
  appointmentDate: string;
  appointmentTime: string;
  completedAt: string;
  actorContext: AccessContext;
  previousStatus: string;
}

export interface ActorWorkGamificationInput {
  context: AccessContext;
  department: ClinicDepartment;
  purpose: ActorEventPurpose;
  eventType: string;
  eventKey: string;
  sourceType: string;
  sourceId: string;
  eventAt: string;
  metricValue?: number;
  reason: string;
  verificationMethod: string;
  payload?: Record<string, unknown>;
}

export interface GamificationEventOutcome {
  recorded: boolean;
  duplicate: boolean;
  eventId: string | null;
  staffId: string | null;
  reason:
    | "recorded"
    | "duplicate"
    | "not_configured"
    | "clinician_unresolved"
    | "actor_role_unresolved"
    | "write_failed";
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function expectedRole(department: ClinicDepartment): "Therapist" | "Dentist" {
  return department === "Dental" ? "Dentist" : "Therapist";
}

function clinicianMatchesDepartment(
  identity: WebStaffIdentity,
  department: ClinicDepartment
): boolean {
  return (
    identity.status === "Active" &&
    identity.roles.includes(expectedRole(department)) &&
    (identity.departmentAccess.includes("All") ||
      identity.departmentAccess.includes(department) ||
      identity.primaryDepartment === department)
  );
}

export function actorGamificationRole(
  context: AccessContext,
  purpose: ActorEventPurpose
): GamificationRoleContext | null {
  const has = (role: GamificationRoleContext) => context.roles.includes(role);

  if (purpose === "reception") {
    for (const role of [
      "Receptionist",
      "Manager",
      "Owner",
      "Dentist",
      "Therapist",
    ] as const) {
      if (has(role)) return role;
    }
    return null;
  }

  if (context.primaryDepartment === "Dental" && has("Dentist")) return "Dentist";
  if (context.primaryDepartment === "Physio" && has("Therapist")) return "Therapist";
  for (const role of [
    "Receptionist",
    "Manager",
    "Dentist",
    "Therapist",
    "Owner",
  ] as const) {
    if (has(role)) return role;
  }
  return null;
}

export function gamificationDepartmentForContext(
  context: AccessContext
): ClinicDepartment | null {
  if (context.primaryDepartment === "Physio" || context.primaryDepartment === "Dental") {
    return context.primaryDepartment;
  }
  const scoped = context.departmentAccess.filter(
    (department): department is ClinicDepartment =>
      department === "Physio" || department === "Dental"
  );
  return scoped.length === 1 ? scoped[0] : null;
}

/**
 * Resolve an appointment's stored Therapist reference without guessing.
 * Staff_ID wins. A full-name match is accepted only when exactly one active
 * clinician in the appointment department has that exact normalized name.
 */
export async function resolveAppointmentClinician(
  therapistReference: string,
  department: ClinicDepartment
): Promise<WebStaffIdentity | null> {
  const reference = normalize(therapistReference);
  if (!reference) return null;

  const directory = (await getWebStaffDirectory()).filter((identity) =>
    clinicianMatchesDepartment(identity, department)
  );
  const byId = directory.filter(
    (identity) => normalize(identity.staffId) === reference
  );
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) return null;

  const byName = directory.filter(
    (identity) => normalize(identity.fullName) === reference
  );
  return byName.length === 1 ? byName[0] : null;
}

/**
 * Post-commit projection for canonical work performed by the current actor.
 * XP is never supplied by this app helper; the Edge Function calculates it
 * from active Owner-configured xp.rules after the verified event is appended.
 */
export async function recordActorWorkGamification(
  input: ActorWorkGamificationInput
): Promise<GamificationEventOutcome> {
  if (!gamificationSupabaseConfigured()) {
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: input.context.staffId,
      reason: "not_configured",
    };
  }

  const roleContext = actorGamificationRole(input.context, input.purpose);
  if (!roleContext) {
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: input.context.staffId,
      reason: "actor_role_unresolved",
    };
  }

  try {
    const result = await recordVerifiedGamificationEvent({
      requestId: `gam-${randomUUID()}`,
      staffId: input.context.staffId,
      department: input.department,
      roleContext,
      eventType: input.eventType,
      eventKey: input.eventKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventAt: input.eventAt,
      metricValue: input.metricValue ?? 1,
      reason: input.reason,
      verifiedBy: `${input.sourceType}:${input.context.staffId}`,
      verificationMethod: input.verificationMethod,
      actorId: input.context.staffId,
      payload: input.payload || {},
    });
    return {
      recorded: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      staffId: input.context.staffId,
      reason: result.duplicate ? "duplicate" : "recorded",
    };
  } catch (error) {
    console.error("Actor work Gamification projection failed", {
      eventType: input.eventType,
      sourceId: input.sourceId,
      staffId: input.context.staffId,
      department: input.department,
      error,
    });
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: input.context.staffId,
      reason: "write_failed",
    };
  }
}

/**
 * Post-commit gamification projection for a verified appointment completion.
 * The deterministic eventKey makes retries idempotent. Any projection failure
 * is contained here so a successful clinic mutation is never turned into a 500.
 */
export async function recordAppointmentCompletionGamification(
  input: AppointmentCompletionGamificationInput
): Promise<GamificationEventOutcome> {
  if (!gamificationSupabaseConfigured()) {
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: null,
      reason: "not_configured",
    };
  }

  let clinician: WebStaffIdentity | null = null;
  try {
    clinician = await resolveAppointmentClinician(
      input.therapistReference,
      input.department
    );
    if (!clinician) {
      return {
        recorded: false,
        duplicate: false,
        eventId: null,
        staffId: null,
        reason: "clinician_unresolved",
      };
    }

    const result = await recordVerifiedGamificationEvent({
      requestId: `gam-${randomUUID()}`,
      staffId: clinician.staffId,
      department: input.department,
      roleContext: expectedRole(input.department),
      eventType: "session_completed",
      eventKey: `appointment:${input.department}:${input.appointmentId}:completed:v2`,
      sourceType: "appointment_status",
      sourceId: input.appointmentId,
      eventAt: input.completedAt,
      metricValue: 1,
      reason: "Verified appointment completed",
      verifiedBy: `appointment_status:${input.actorContext.staffId}`,
      verificationMethod: "canonical_appointment_transition",
      actorId: input.actorContext.staffId,
      payload: {
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        appointmentDate: input.appointmentDate,
        appointmentTime: input.appointmentTime,
        assignedClinician: clinician.staffId,
        therapistReference: input.therapistReference,
        previousStatus: input.previousStatus,
        completedStatus: "Completed",
      },
    });
    return {
      recorded: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      staffId: clinician.staffId,
      reason: result.duplicate ? "duplicate" : "recorded",
    };
  } catch (error) {
    console.error("Appointment completion gamification projection failed", {
      appointmentId: input.appointmentId,
      department: input.department,
      clinician: clinician?.staffId || null,
      error,
    });
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: clinician?.staffId || null,
      reason: "write_failed",
    };
  }
}
