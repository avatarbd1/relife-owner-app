import "server-only";

import {
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

export type ChamberScheduleInput = FixedHourInput;
export type ChamberScheduleValidation = FixedHourValidation;

async function warmSupabaseReference(
  context: AccessContext,
  input: ChamberScheduleInput,
  validation: ChamberScheduleValidation
): Promise<void> {
  try {
    const patient = await getPatientForContext(context, input.patientId);
    if (!patient || patient.department !== "Physio") return;

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
    console.warn("Supabase Chamber cache warm failed", error);
  }
}

/**
 * Canonical Chamber booking validation entry point.
 *
 * Supabase may serve repeated shadow validation, but Sheets remains the proven
 * final-write validator until the transactional cutover is explicitly enabled.
 */
export async function validateChamberSchedule(
  context: AccessContext,
  input: ChamberScheduleInput
): Promise<ChamberScheduleValidation> {
  if (!shouldUseSupabaseValidation()) {
    return validateFixedHourBooking(context, input);
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
 * Final creation revalidates through the current fixed-hour engine inside the
 * date-scoped mutation lock. No UI/API route may call the migration engine
 * directly after consolidation.
 */
export async function createChamberScheduleBooking(
  context: AccessContext,
  input: ChamberScheduleInput
): Promise<{
  appointmentId: string;
  validation: ChamberScheduleValidation;
}> {
  return withMutationLock(`appointment-create:${input.date}`, () =>
    createFixedHourBooking(context, input)
  );
}
