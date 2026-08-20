import "server-only";

import {
  createCapacityBooking,
  validateCapacityBooking,
  type CapacityBookingInput,
  type CapacityBookingValidation,
} from "@/lib/domain/appointments/capacityBooking";
import type { AccessContext } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";

/**
 * Deprecated Chamber-scheduling compatibility shape.
 *
 * requestedBedId, modalities and requestId are accepted only so old callers do
 * not crash. They do not participate in booking policy. General-bed assignment,
 * machine exclusivity, exact machine timing and treatment sequencing belong to
 * live Chamber operation after the appointment exists.
 */
export type ChamberScheduleInput = CapacityBookingInput & {
  requestedBedId?: string;
  modalities?: string[];
  requestId?: string;
};

export type ChamberScheduleValidation = CapacityBookingValidation;

function capacityInput(input: ChamberScheduleInput): CapacityBookingInput {
  return {
    patientId: input.patientId,
    date: input.date,
    time: input.time,
    therapist: input.therapist,
    remarks: input.remarks,
  };
}

/** @deprecated Use validateCapacityBooking from appointments/capacityBooking. */
export async function validateChamberSchedule(
  context: AccessContext,
  input: ChamberScheduleInput
): Promise<ChamberScheduleValidation> {
  return validateCapacityBooking(context, capacityInput(input));
}

/** @deprecated Use createCapacityBooking from appointments/capacityBooking. */
export async function createChamberScheduleBooking(
  context: AccessContext,
  input: ChamberScheduleInput
): Promise<{
  appointmentId: string;
  validation: ChamberScheduleValidation;
}> {
  const canonical = capacityInput(input);
  return withMutationLock(`capacity-booking:${canonical.date}`, () =>
    createCapacityBooking(context, canonical)
  );
}
