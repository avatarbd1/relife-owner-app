import "server-only";

import {
  createUnifiedPhysioBooking,
  validateUnifiedPhysioBooking,
  type UnifiedPhysioBookingInput,
} from "@/lib/domain/appointments/create";
import {
  chamberRoomForBed,
  normalizeChamberBedId,
  type ChamberBedId,
} from "@/lib/domain/chamber/bedAllocation";
import { chamberStartMinutes, isPhysioChamberStart } from "@/lib/domain/chamber/hours";
import type { AccessContext } from "@/lib/webos/access";
import type {
  BookingTimelineStep,
  BookingValidationResult,
} from "@/lib/webos/appointmentScheduling";
import { withMutationLock } from "@/lib/webos/mutationLock";

export type ChamberBookingInput = UnifiedPhysioBookingInput & {
  requestedBedId?: string;
};

export interface RequestedBedValidation extends BookingValidationResult {
  requestedBedId: ChamberBedId;
  slotStartMinute: number;
  slotEndMinute: number;
  slotLabel: string;
  totalSelectedMin: number;
  remainingMin: number;
  timeline: BookingTimelineStep[];
}

export type ChamberBookingValidation =
  | BookingValidationResult
  | RequestedBedValidation;

export interface ChamberBookingResult {
  appointmentId: string;
  validation: ChamberBookingValidation;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function requestedBed(input: ChamberBookingInput): ChamberBedId | "" {
  const text = normalize(input.requestedBedId);
  if (!text) return "";
  const bedId = normalizeChamberBedId(text);
  if (!bedId) throw new Error("INVALID_BED");
  return bedId;
}

function assertRequestedBedSlot(input: ChamberBookingInput): void {
  if (requestedBed(input) && !isPhysioChamberStart(input.time)) {
    throw new Error("INVALID_SLOT");
  }
}

function slotLabel(startMinute: number): string {
  const hour = (value: number) => String((Math.floor(value / 60) % 12) || 12);
  return `${hour(startMinute)}–${hour(startMinute + 60)}`;
}

function selectedMinutes(
  input: ChamberBookingInput,
  validation: BookingValidationResult
): number {
  const selected = new Set(input.modalities || []);
  return validation.modalityOptions.reduce(
    (sum, option) => sum + (selected.has(option.value) ? option.durationMin : 0),
    0
  );
}

function compatibilityValidation(
  input: ChamberBookingInput,
  validation: BookingValidationResult
): ChamberBookingValidation {
  const bedId = requestedBed(input);
  if (!bedId) return validation;
  const startMinute = chamberStartMinutes(input.time);
  if (!Number.isFinite(startMinute)) throw new Error("INVALID_TIME");
  const totalSelectedMin = selectedMinutes(input, validation);
  return {
    ...validation,
    requestedBedId: bedId,
    roomId: validation.roomId || chamberRoomForBed(bedId),
    slotStartMinute: startMinute,
    slotEndMinute: startMinute + 60,
    slotLabel: slotLabel(startMinute),
    totalSelectedMin,
    remainingMin: Math.max(0, 60 - totalSelectedMin),
  };
}

/**
 * Canonical Chamber booking validation facade.
 *
 * Requested-bed and automatic-bed flows now share the same unified Physio
 * validation engine. The compatibility projection keeps the existing Chamber
 * UI response fields while the underlying writer remains singular.
 */
export async function validateChamberBooking(
  context: AccessContext,
  input: ChamberBookingInput
): Promise<ChamberBookingValidation> {
  assertRequestedBedSlot(input);
  const validation = await validateUnifiedPhysioBooking(context, input);
  return compatibilityValidation(input, validation);
}

/**
 * Canonical Chamber booking command facade.
 *
 * One date-scoped mutation lock protects both automatic and requested-bed
 * bookings. createUnifiedPhysioBooking is the only active booking writer.
 */
export async function createChamberBooking(
  context: AccessContext,
  input: ChamberBookingInput
): Promise<ChamberBookingResult> {
  assertRequestedBedSlot(input);
  const lockKey = `appointment-create:${normalize(input.date)}`;
  return withMutationLock(lockKey, async () => {
    const result = await createUnifiedPhysioBooking(context, input);
    return {
      appointmentId: result.appointmentId,
      validation: compatibilityValidation(input, result.validation),
    };
  });
}
