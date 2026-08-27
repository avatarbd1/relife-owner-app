import "server-only";

import { randomUUID } from "node:crypto";
import {
  gamificationSupabaseConfigured,
  recordVerifiedGamificationEvent,
} from "@/lib/data/supabaseGamification";
import { hasTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
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

type TenantBoundGamificationInput = {
  tenant: TenantScope;
};

export interface AppointmentCompletionGamificationInput extends TenantBoundGamificationInput {
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

export interface TreatmentDocumentationGamificationInput extends TenantBoundGamificationInput {
  treatmentId: string;
  patientId: string;
  department: ClinicDepartment;
  clinicianReference: string;
  documentedAt: string;
  actorContext: AccessContext;
  sourceType: "clinical_session" | "chamber_completion";
}

export interface CashReconciliationGamificationInput extends TenantBoundGamificationInput {
  movementId: string;
  department: ClinicDepartment;
  staffReference: string;
  reconciledAt: string;
  difference: number;
  actorContext: AccessContext;
}

export interface ActorWorkGamificationInput extends TenantBoundGamificationInput {
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
    | "feature_disabled"
    | "clinician_unresolved"
    | "staff_unresolved"
    | "actor_role_unresolved"
    | "write_failed";
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function expectedRole(department: ClinicDepartment): "Therapist" | "Dentist" {
  return department === "Dental" ? "Dentist" : "Therapist";
}

function roleMatchesDepartment(
  identity: WebStaffIdentity,
  department: ClinicDepartment,
  role: "Therapist" | "Dentist" | "Receptionist"
): boolean {
  return (
    identity.status === "Active" &&
    identity.roles.includes(role) &&
    (identity.departmentAccess.includes("All") ||
      identity.departmentAccess.includes(department) ||
      identity.primaryDepartment === department)
  );
}

function clinicianMatchesDepartment(
  identity: WebStaffIdentity,
  department: ClinicDepartment
): boolean {
  return roleMatchesDepartment(identity, department, expectedRole(department));
}

async function resolveRoleReference(
  referenceInput: string,
  department: ClinicDepartment,
  role: "Therapist" | "Dentist" | "Receptionist"
): Promise<WebStaffIdentity | null> {
  const reference = normalize(referenceInput);
  if (!reference) return null;
  const directory = (await getWebStaffDirectory()).filter((identity) =>
    roleMatchesDepartment(identity, department, role)
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

async function gamificationFeatureEnabled(tenant: TenantScope): Promise<boolean> {
  if (!gamificationSupabaseConfigured()) return false;
  try {
    return await hasTenantFeature(tenant, "optional.gamification");
  } catch (error) {
    console.error("Gamification feature decision unavailable", { tenant, error });
    return false;
  }
}

function unavailableOutcome(
  staffId: string | null,
  reason: "not_configured" | "feature_disabled"
): GamificationEventOutcome {
  return { recorded: false, duplicate: false, eventId: null, staffId, reason };
}

async function projectionAvailable(
  tenant: TenantScope,
  staffId: string | null
): Promise<GamificationEventOutcome | null> {
  if (!gamificationSupabaseConfigured()) return unavailableOutcome(staffId, "not_configured");
  if (!(await gamificationFeatureEnabled(tenant))) return unavailableOutcome(staffId, "feature_disabled");
  return null;
}

/**
 * Post-commit projection for canonical work performed by the current actor.
 * XP is never supplied by this app helper; the Edge Function calculates it
 * from active Owner-configured xp.rules after the verified event is appended.
 */
export async function recordActorWorkGamification(
  input: ActorWorkGamificationInput
): Promise<GamificationEventOutcome> {
  const unavailable = await projectionAvailable(input.tenant, input.context.staffId);
  if (unavailable) return unavailable;

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
    const result = await recordVerifiedGamificationEvent(input.tenant, {
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

/** Project a canonical human-verified treatment note to the scoring stream. */
export async function recordTreatmentDocumentationGamification(
  input: TreatmentDocumentationGamificationInput
): Promise<GamificationEventOutcome> {
  const unavailable = await projectionAvailable(input.tenant, null);
  if (unavailable) return unavailable;

  let clinician: WebStaffIdentity | null = null;
  try {
    clinician = await resolveAppointmentClinician(
      input.clinicianReference,
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

    const result = await recordVerifiedGamificationEvent(input.tenant, {
      requestId: `gam-${randomUUID()}`,
      staffId: clinician.staffId,
      department: input.department,
      roleContext: expectedRole(input.department),
      eventType: "treatment_documented",
      eventKey: `treatment:${input.department}:${input.treatmentId}:documented:v2`,
      sourceType: input.sourceType,
      sourceId: input.treatmentId,
      eventAt: input.documentedAt,
      metricValue: 1,
      reason: "Verified treatment documentation recorded",
      verifiedBy: `${input.sourceType}:${input.actorContext.staffId}`,
      verificationMethod: "canonical_human_verified_treatment_note",
      actorId: input.actorContext.staffId,
      payload: {
        treatmentId: input.treatmentId,
        patientId: input.patientId,
        assignedClinician: clinician.staffId,
        documentationVerified: true,
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
    console.error("Treatment documentation Gamification projection failed", {
      treatmentId: input.treatmentId,
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

/** Project a human-confirmed cash handover result to Receptionist scoring. */
export async function recordCashReconciliationGamification(
  input: CashReconciliationGamificationInput
): Promise<GamificationEventOutcome> {
  const unavailable = await projectionAvailable(input.tenant, null);
  if (unavailable) return unavailable;

  let receptionist: WebStaffIdentity | null = null;
  try {
    receptionist = await resolveRoleReference(
      input.staffReference,
      input.department,
      "Receptionist"
    );
    if (!receptionist) {
      return {
        recorded: false,
        duplicate: false,
        eventId: null,
        staffId: null,
        reason: "staff_unresolved",
      };
    }

    const exact = Math.abs(input.difference) <= 0.01;
    const eventType = exact
      ? "cash_reconciliation_exact"
      : "cash_reconciliation_mismatch";
    const result = await recordVerifiedGamificationEvent(input.tenant, {
      requestId: `gam-${randomUUID()}`,
      staffId: receptionist.staffId,
      department: input.department,
      roleContext: "Receptionist",
      eventType,
      eventKey: `cash-movement:${input.department}:${input.movementId}:reconciled:v2`,
      sourceType: "cash_movement_acceptance",
      sourceId: input.movementId,
      eventAt: input.reconciledAt,
      metricValue: 1,
      reason: exact
        ? "Verified cash handover reconciled exactly"
        : "Verified cash handover mismatch",
      verifiedBy: `cash_movement_acceptance:${input.actorContext.staffId}`,
      verificationMethod: "canonical_cash_handover_confirmation",
      actorId: input.actorContext.staffId,
      payload: {
        movementId: input.movementId,
        staffId: receptionist.staffId,
        differenceWasZero: exact,
        confirmedBy: input.actorContext.staffId,
      },
    });
    return {
      recorded: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      staffId: receptionist.staffId,
      reason: result.duplicate ? "duplicate" : "recorded",
    };
  } catch (error) {
    console.error("Cash reconciliation Gamification projection failed", {
      movementId: input.movementId,
      department: input.department,
      receptionist: receptionist?.staffId || null,
      error,
    });
    return {
      recorded: false,
      duplicate: false,
      eventId: null,
      staffId: receptionist?.staffId || null,
      reason: "write_failed",
    };
  }
}

/** Post-commit projection for a verified appointment completion. */
export async function recordAppointmentCompletionGamification(
  input: AppointmentCompletionGamificationInput
): Promise<GamificationEventOutcome> {
  const unavailable = await projectionAvailable(input.tenant, null);
  if (unavailable) return unavailable;

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

    const result = await recordVerifiedGamificationEvent(input.tenant, {
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
