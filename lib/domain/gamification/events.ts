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
 * Post-commit gamification projection for a verified appointment completion.
 * The deterministic eventKey makes retries idempotent. Failure never awards
 * guessed XP and never rewrites the canonical appointment mutation.
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

  const clinician = await resolveAppointmentClinician(
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

  try {
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
      xpAwarded: 1,
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
      clinician: clinician.staffId,
      error,
    });
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: clinician.staffId,
      reason: "write_failed",
    };
  }
}
