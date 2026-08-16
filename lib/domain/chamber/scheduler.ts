import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  createSupabaseFixedHourBooking,
  shouldUseSupabaseValidation,
  syncSupabaseChamberCache,
} from "@/lib/data/supabaseChamber";
import type { AccessContext } from "@/lib/webos/access";
import {
  createFixedHourBooking,
  validateFixedHourBooking,
  type FixedHourInput,
  type FixedHourValidation,
} from "@/lib/webos/chamberFixedHour";
import { validateFixedHourBookingWithSupabase } from "@/lib/webos/chamberSupabaseValidation";
import { getPatientForContext } from "@/lib/webos/reception";
import { withMutationLock } from "@/lib/webos/mutationLock";

export type ChamberScheduleInput = FixedHourInput & { requestId?: string };
export type ChamberScheduleValidation = FixedHourValidation;

async function warmSupabaseReference(
  context: AccessContext,
  input: ChamberScheduleInput,
  validation: ChamberScheduleValidation,
  strict = false
): Promise<void> {
  try {
    const patient = await getPatientForContext(context, input.patientId);
    if (!patient || patient.department !== "Physio") {
      if (strict) throw new Error("PATIENT_NOT_FOUND");
      return;
    }

    const suggestedLabels = validation.suggestedModalities.flatMap((value) => {
      const option = validation.modalityOptions.find((item) => item.value === value);
      return option ? [option.label] : [];
    });
    if (validation.needsTraction) suggestedLabels.push("Traction");

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
          electrotherapyPlan: suggestedLabels.join(" "),
          manualTherapyPlan: validation.suggestedModalities.includes("MANUAL")
            ? "Manual Therapy"
            : "",
          exercisePlan: "",
          status: "Active",
        },
      ],
    });
  } catch (error) {
    if (strict) throw error;
    console.warn("Supabase Chamber cache warm failed", error);
  }
}

function mergeCutoverValidation(
  sheets: ChamberScheduleValidation,
  supabase: ChamberScheduleValidation
): ChamberScheduleValidation {
  const conflicts = [...supabase.conflicts, ...sheets.conflicts];
  const unique = [
    ...new Map(conflicts.map((item) => [`${item.type}:${item.message}`, item])).values(),
  ];
  return {
    ...supabase,
    isValid: unique.length === 0,
    conflicts: unique,
    suggestedModalities: [
      ...new Set([...supabase.suggestedModalities, ...sheets.suggestedModalities]),
    ],
    needsTraction: supabase.needsTraction || sheets.needsTraction,
  };
}

/**
 * Canonical Chamber booking validation entry point.
 *
 * shadow: Supabase validates when available, with Sheets as safe fallback.
 * supabase: transitional cutover validates both stores so legacy Sheets rows
 * cannot be double-booked while new transactional rows live in Supabase.
 */
export async function validateChamberSchedule(
  context: AccessContext,
  input: ChamberScheduleInput
): Promise<ChamberScheduleValidation> {
  if (!shouldUseSupabaseValidation()) {
    return validateFixedHourBooking(context, input);
  }

  if (chamberDbMode() === "supabase") {
    if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");
    const sheets = await validateFixedHourBooking(context, input);
    await warmSupabaseReference(context, input, sheets, true);
    const supabase = await validateFixedHourBookingWithSupabase(context, input);
    return mergeCutoverValidation(sheets, supabase);
  }

  try {
    return await validateFixedHourBookingWithSupabase(context, input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "SUPABASE_VALIDATION_FAILED";
    if (
      [
        "INVALID_DATE",
        "INVALID_TIME",
        "INVALID_SLOT",
        "INVALID_BED",
        "INVALID_THERAPIST",
        "ACCESS_DENIED",
      ].includes(message)
    ) {
      throw error;
    }

    console.warn("Supabase Chamber validation fallback to Sheets:", message);
    const validation = await validateFixedHourBooking(context, input);
    void warmSupabaseReference(context, input, validation);
    return validation;
  }
}

/**
 * Canonical Chamber booking command.
 *
 * Sheets remains the default writer. When RELIFE_CHAMBER_DB_MODE=supabase is
 * deliberately enabled, the final write is one Postgres transaction. During
 * the transition validation still checks both stores to protect legacy rows.
 *
 * Fixed-hour retries are semantically idempotent in the database transaction:
 * the same active patient + hour + therapist + bed returns the existing booking.
 * A requestId is forwarded when supplied, but the current fixed-hour UI does
 * not need a client nonce for retry safety.
 */
export async function createChamberScheduleBooking(
  context: AccessContext,
  input: ChamberScheduleInput
): Promise<{
  appointmentId: string;
  validation: ChamberScheduleValidation;
}> {
  if (chamberDbMode() !== "supabase") {
    return withMutationLock(`appointment-create:${input.date}`, () =>
      createFixedHourBooking(context, input)
    );
  }
  if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");

  const validation = await validateChamberSchedule(context, input);
  if (!validation.isValid) {
    const first = validation.conflicts[0];
    const error = new Error(
      `APPOINTMENT_CONFLICT:${first?.type || "other"}:${first?.message || "Booking conflict"}`
    );
    (error as Error & { validation?: ChamberScheduleValidation }).validation = validation;
    throw error;
  }

  try {
    const result = await createSupabaseFixedHourBooking({
      patientId: validation.patientId,
      date: input.date,
      startMinute: validation.slotStartMinute,
      therapist: input.therapist,
      bedId: validation.requestedBedId,
      modalities: input.modalities || [],
      timeline: validation.timeline.map((step) => ({
        name: step.name,
        resourceId: step.resourceId,
        resourceName: step.resourceId ? step.name : "",
        durationMin: step.durationMin,
        startMinute: step.startMinute,
        endMinute: step.endMinute,
      })),
      remarks: input.remarks || "",
      actorId: context.staffId,
      requestId: input.requestId || undefined,
    });
    return { appointmentId: result.appointmentId, validation };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 409) {
      const detail = error instanceof Error ? error.message : "Booking conflict";
      const wrapped = new Error(`APPOINTMENT_CONFLICT:database:${detail}`);
      (wrapped as Error & { validation?: ChamberScheduleValidation }).validation = validation;
      throw wrapped;
    }
    throw error;
  }
}
