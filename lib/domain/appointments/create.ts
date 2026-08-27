import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  createSupabaseValidatedBooking,
  syncSupabaseChamberCache,
  validateSupabaseBookingPlan,
  type SupabaseValidatedBookingPlan,
} from "@/lib/data/supabaseChamber";
import { applyTherapistCapacityValidation } from "@/lib/domain/appointments/therapistCapacity";
import {
  chamberStartMinutes,
  isPhysioChamberStart,
} from "@/lib/domain/chamber/hours";
import type { AccessContext } from "@/lib/webos/access";
import {
  createPhysioBooking,
  validatePhysioBooking,
  type BookingConflict,
  type BookingValidationResult,
  type PhysioBookingInput,
} from "@/lib/webos/appointmentScheduling";
import { getPatientForContext } from "@/lib/webos/reception";

export interface UnifiedPhysioBookingInput extends PhysioBookingInput {
  requestId?: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function requestId(value: unknown): string {
  const text = normalize(value);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(text)) throw new Error("INVALID_REQUEST_ID");
  return text;
}

function assertPhysioChamberStart(value: string): number {
  const startMinute = chamberStartMinutes(value);
  if (!Number.isFinite(startMinute)) throw new Error("INVALID_TIME");
  if (!isPhysioChamberStart(value)) throw new Error("INVALID_SLOT");
  return startMinute;
}

function bedLabel(bedId: string): string {
  if (bedId === "TRACTION-BED") return "Traction Bed";
  const match = /^BED-([1-4])$/.exec(bedId);
  return match ? `Bed ${match[1]}` : bedId;
}

function withFlowTag(
  remarks: string,
  validation: BookingValidationResult
): string {
  const clean = normalize(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const station = validation.station === "Traction" ? "Traction" : "Treatment";
  const tag = `[PTFLOW gender=${validation.gender};room=${validation.roomId};bed=${bedLabel(validation.assignedBedId)};station=${station}]`;
  return `${clean} ${tag}`.trim();
}

function conflictType(value: string): BookingConflict["type"] {
  if (value === "duplicate") return "duplicate";
  if (value === "gender_required") return "gender_required";
  if (value === "gender_rule") return "gender_rule";
  if (value === "machine_busy") return "machine_busy";
  if (value === "therapist_busy") return "therapist_busy" as BookingConflict["type"];
  if (value === "bed_busy" || value === "no_bed") return "no_bed";
  return "schema";
}

function addDatabaseConflicts(
  validation: BookingValidationResult,
  conflicts: Array<{ type: string; message: string }>
): BookingValidationResult {
  if (conflicts.length === 0) return validation;
  const merged = [
    ...validation.conflicts,
    ...conflicts.map((item) => ({
      type: conflictType(item.type),
      message: normalize(item.message) || "Supabase booking conflict",
    })),
  ];
  const unique = [
    ...new Map(merged.map((item) => [`${item.type}:${item.message}`, item])).values(),
  ];
  return {
    ...validation,
    isValid: false,
    conflicts: unique,
    // Legacy suggestions do not know about Supabase-only reservations. Do not
    // surface a suggestion that may already be occupied in the cutover store.
    suggestions: [],
  };
}

function throwValidationConflict(validation: BookingValidationResult): never {
  const primary = validation.conflicts[0];
  const error = new Error(
    `APPOINTMENT_CONFLICT:${primary?.type || "other"}:${primary?.message || "Booking conflict"}`
  );
  (error as Error & { validation?: BookingValidationResult }).validation = validation;
  throw error;
}

async function sheetValidationWithTherapist(
  context: AccessContext,
  input: UnifiedPhysioBookingInput
): Promise<BookingValidationResult> {
  assertPhysioChamberStart(input.time);
  const validation = await validatePhysioBooking(context, input);
  const withTherapist = await applyTherapistCapacityValidation(input, validation);
  return {
    ...withTherapist,
    suggestions: withTherapist.suggestions.filter((item) => isPhysioChamberStart(item.time)),
  };
}

async function syncReference(
  context: AccessContext,
  validation: BookingValidationResult
): Promise<void> {
  const patient = await getPatientForContext(context, validation.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");

  const suggestedLabels = validation.suggestedModalities.flatMap((value) => {
    const option = validation.modalityOptions.find((item) => item.value === value);
    return option ? [option.label] : [];
  });
  if (validation.needsTraction) suggestedLabels.push("Traction");
  const hasManual = validation.suggestedModalities.includes("MANUAL");

  await syncSupabaseChamberCache({
    patients: [
      {
        patientId: patient.patientId,
        fullName: patient.fullName,
        gender: patient.gender,
        therapist: patient.therapist,
        status: patient.status,
        department: "Physio",
      },
    ],
    plans: [
      {
        patientId: patient.patientId,
        electrotherapyPlan: suggestedLabels.filter((item) => item !== "Manual Therapy").join(" "),
        manualTherapyPlan: hasManual ? "Manual Therapy" : "",
        exercisePlan: "",
        status: "Active",
      },
    ],
  });
}

function validatedPlan(
  input: UnifiedPhysioBookingInput,
  validation: BookingValidationResult
): SupabaseValidatedBookingPlan {
  return {
    patientId: validation.patientId,
    date: normalize(input.date),
    startMinute: assertPhysioChamberStart(input.time),
    therapist: normalize(input.therapist),
    bedId: validation.assignedBedId,
    gender: validation.gender,
    roomId: validation.roomId,
    modalities: [...new Set(input.modalities || [])],
    totalDurationMin: validation.totalDurationMin,
    timeline: validation.timeline.map((step) => ({
      sequence: step.sequence,
      name: step.name,
      resourceId: step.resourceId,
      resourceName: step.resourceName,
      durationMin: step.durationMin,
      startMinute: step.startMinute,
      endMinute: step.endMinute,
    })),
    remarks: withFlowTag(input.remarks || "", validation),
  };
}

export async function validateUnifiedPhysioBooking(
  context: AccessContext,
  input: UnifiedPhysioBookingInput
): Promise<BookingValidationResult> {
  const sheets = await sheetValidationWithTherapist(context, input);
  if (chamberDbMode() !== "supabase") return sheets;
  if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");
  if (!sheets.isValid) return sheets;

  await syncReference(context, sheets);
  const conflicts = await validateSupabaseBookingPlan(validatedPlan(input, sheets));
  return addDatabaseConflicts(sheets, conflicts);
}

export async function createUnifiedPhysioBooking(
  context: AccessContext,
  input: UnifiedPhysioBookingInput
): Promise<{ appointmentId: string; validation: BookingValidationResult }> {
  assertPhysioChamberStart(input.time);
  if (chamberDbMode() !== "supabase") {
    // The API date-scoped mutation lock keeps this capacity pre-check and the
    // existing atomic Sheets append in one serialized booking critical section.
    const validation = await sheetValidationWithTherapist(context, input);
    if (!validation.isValid) throwValidationConflict(validation);
    return createPhysioBooking(context, input);
  }
  if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");
  const stableRequestId = requestId(input.requestId);

  // Re-run the proven Sheets rules on submit. The Edge transaction then checks
  // the Supabase side again under a tenant/date advisory lock before inserting.
  const validation = await sheetValidationWithTherapist(context, input);
  if (!validation.isValid) throwValidationConflict(validation);

  await syncReference(context, validation);
  try {
    const result = await createSupabaseValidatedBooking({
      plan: validatedPlan(input, validation),
      actorId: context.staffId,
      requestId: stableRequestId,
    });
    return { appointmentId: result.appointmentId, validation };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const payload = (error as Error & { payload?: Record<string, unknown> }).payload;
    if (status === 409) {
      const detail = normalize(payload?.detail) || (error instanceof Error ? error.message : "Booking conflict");
      const conflict: BookingConflict = { type: "schema", message: detail };
      const merged = addDatabaseConflicts(validation, [
        { type: normalize(payload?.conflictType) || "database", message: detail },
      ]);
      const wrapped = new Error(`APPOINTMENT_CONFLICT:${conflict.type}:${detail}`);
      (wrapped as Error & { validation?: BookingValidationResult }).validation = merged;
      throw wrapped;
    }
    throw error;
  }
}
