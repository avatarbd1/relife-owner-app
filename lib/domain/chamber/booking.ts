import "server-only";

import {
  createUnifiedPhysioBooking,
  validateUnifiedPhysioBooking,
  type UnifiedPhysioBookingInput,
} from "@/lib/domain/appointments/create";
import { isPhysioChamberStart } from "@/lib/domain/chamber/hours";
import type { AccessContext } from "@/lib/webos/access";
import {
  createFixedHourBooking,
  validateFixedHourBooking,
  type FixedHourInput,
  type FixedHourValidation,
} from "@/lib/webos/chamberFixedHour";
import type { BookingValidationResult } from "@/lib/webos/appointmentScheduling";
import { withMutationLock } from "@/lib/webos/mutationLock";

export type ChamberBookingInput = UnifiedPhysioBookingInput & {
  requestedBedId?: string;
};

export type ChamberBookingValidation =
  | BookingValidationResult
  | FixedHourValidation;

export interface ChamberBookingResult {
  appointmentId: string;
  validation: ChamberBookingValidation;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function usesRequestedBed(input: ChamberBookingInput): boolean {
  return Boolean(normalize(input.requestedBedId));
}

function fixedHourInput(input: ChamberBookingInput): FixedHourInput {
  return {
    patientId: input.patientId,
    date: input.date,
    time: input.time,
    therapist: input.therapist,
    requestedBedId: normalize(input.requestedBedId),
    modalities: input.modalities || [],
    remarks: input.remarks || "",
  };
}

function assertRequestedBedSlot(input: ChamberBookingInput): void {
  if (usesRequestedBed(input) && !isPhysioChamberStart(input.time)) {
    throw new Error("INVALID_SLOT");
  }
}

/**
 * Canonical Chamber booking validation facade.
 *
 * Normal Physio bookings use the unified appointment command. Requested-bed
 * compatibility is intentionally kept behind this boundary until the fixed-bed
 * rules are migrated into the unified engine. API routes must not branch on
 * legacy writers directly.
 */
export async function validateChamberBooking(
  context: AccessContext,
  input: ChamberBookingInput
): Promise<ChamberBookingValidation> {
  assertRequestedBedSlot(input);
  if (usesRequestedBed(input)) {
    return validateFixedHourBooking(context, fixedHourInput(input));
  }
  return validateUnifiedPhysioBooking(context, input);
}

/**
 * Canonical Chamber booking command facade.
 *
 * Keep the date-scoped mutation lock around validation/write parity for both
 * compatibility and unified paths. This preserves existing behavior while the
 * requested-bed implementation is consolidated in a later step.
 */
export async function createChamberBooking(
  context: AccessContext,
  input: ChamberBookingInput
): Promise<ChamberBookingResult> {
  assertRequestedBedSlot(input);
  const lockKey = `appointment-create:${normalize(input.date)}`;
  return withMutationLock(lockKey, async () => {
    if (usesRequestedBed(input)) {
      return createFixedHourBooking(context, fixedHourInput(input));
    }
    return createUnifiedPhysioBooking(context, input);
  });
}
