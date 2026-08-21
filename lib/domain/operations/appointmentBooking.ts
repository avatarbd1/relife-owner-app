import "server-only";

import { randomUUID } from "node:crypto";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { dhakaClockParts } from "@/lib/config/relifeSystem";
import type { Scope } from "@/lib/types";

export interface BookAppointmentInput {
  patientId: string;
  therapistId?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  duration: number; // minutes
  department: "Physio" | "Dental";
  requestId: string;
}

export interface AppointmentBookingResult {
  appointmentId: string;
  patientId: string;
  therapistId: string;
  date: string;
  startTime: string;
  duration: number;
  department: "Physio" | "Dental";
  duplicate: boolean;
}

export interface AvailabilitySlot {
  startTime: string;
  duration: number;
  available: boolean;
}

export interface TherapistSchedule {
  therapistId: string;
  therapistName: string;
  availableSlots: AvailabilitySlot[];
}

// In-memory storage for demo (will be replaced with database)
const appointments = new Map<string, {
  patientId: string;
  therapistId: string;
  date: string;
  startTime: string;
  duration: number;
  department: "Physio" | "Dental";
}>();

const requestIdLog = new Set<string>();

// Helper: Parse time HH:MM to minutes since midnight
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Helper: Convert minutes since midnight to HH:MM
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Helper: Check if two time slots overlap
function slotsOverlap(
  slot1Start: number,
  slot1Duration: number,
  slot2Start: number,
  slot2Duration: number
): boolean {
  const slot1End = slot1Start + slot1Duration;
  const slot2End = slot2Start + slot2Duration;
  return slot1Start < slot2End && slot2Start < slot1End;
}

export async function bookAppointment(
  context: AccessContext,
  input: BookAppointmentInput
): Promise<AppointmentBookingResult> {
  assertCanPerform(context, "appointment.create", input.department);

  // Validate input
  if (!input.patientId) {
    throw new Error("MISSING_PATIENT_ID");
  }

  if (!input.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new Error("INVALID_DATE_FORMAT");
  }

  if (!input.startTime.match(/^\d{2}:\d{2}$/)) {
    throw new Error("INVALID_TIME_FORMAT");
  }

  if (input.duration < 15 || input.duration > 480) {
    throw new Error("INVALID_DURATION");
  }

  // Check for duplicate request
  if (requestIdLog.has(input.requestId)) {
    const existing = Array.from(appointments.entries()).find(
      ([_, v]) => v.patientId === input.patientId && v.date === input.date
    );
    if (existing) {
      return {
        appointmentId: existing[0],
        patientId: input.patientId,
        therapistId: existing[1].therapistId,
        date: input.date,
        startTime: input.startTime,
        duration: input.duration,
        department: input.department,
        duplicate: true,
      };
    }
  }

  // Get directory
  const directory = await getWebStaffDirectory();

  // Auto-assign therapist if not specified
  let therapistId = input.therapistId;
  if (!therapistId) {
    const availableTherapist = directory.find(
      (s) => s.primaryDepartment === input.department && s.status === "Active" && s.roles.includes("Therapist")
    );
    if (!availableTherapist) {
      throw new Error("NO_THERAPIST_AVAILABLE");
    }
    therapistId = availableTherapist.staffId;
  }

  // Verify therapist exists and is in correct department
  const therapist = directory.find(
    (s) => s.staffId === therapistId && s.primaryDepartment === input.department && s.status === "Active"
  );

  if (!therapist) {
    throw new Error("THERAPIST_NOT_FOUND");
  }

  // Check for conflicts
  const requestedSlotStart = timeToMinutes(input.startTime);
  for (const [_, appt] of appointments.entries()) {
    if (
      appt.therapistId === therapistId &&
      appt.date === input.date &&
      slotsOverlap(
        requestedSlotStart,
        input.duration,
        timeToMinutes(appt.startTime),
        appt.duration
      )
    ) {
      throw new Error("TIME_SLOT_CONFLICT");
    }
  }

  // Check business hours (9 AM to 5 PM)
  const startMinutes = timeToMinutes(input.startTime);
  const endMinutes = startMinutes + input.duration;
  if (startMinutes < 9 * 60 || endMinutes > 17 * 60) {
    throw new Error("OUTSIDE_BUSINESS_HOURS");
  }

  // Create appointment
  const appointmentId = randomUUID();
  appointments.set(appointmentId, {
    patientId: input.patientId,
    therapistId,
    date: input.date,
    startTime: input.startTime,
    duration: input.duration,
    department: input.department,
  });

  requestIdLog.add(input.requestId);

  return {
    appointmentId,
    patientId: input.patientId,
    therapistId,
    date: input.date,
    startTime: input.startTime,
    duration: input.duration,
    department: input.department,
    duplicate: false,
  };
}

export async function getTherapistAvailability(
  context: AccessContext,
  therapistId: string,
  date: string,
  department: "Physio" | "Dental"
): Promise<TherapistSchedule> {
  assertCanPerform(context, "appointment.read", department);

  const directory = await getWebStaffDirectory();
  const therapist = directory.find((s) => s.staffId === therapistId);

  if (!therapist) {
    throw new Error("THERAPIST_NOT_FOUND");
  }

  const availableSlots: AvailabilitySlot[] = [];

  // Generate 30-minute slots from 9 AM to 5 PM
  for (let hour = 9; hour < 17; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const startMinutes = hour * 60 + minute;
      const startTime = minutesToTime(startMinutes);

      // Check if this slot conflicts with any appointments
      let hasConflict = false;
      for (const [_, appt] of appointments.entries()) {
        if (
          appt.therapistId === therapistId &&
          appt.date === date &&
          slotsOverlap(startMinutes, 30, timeToMinutes(appt.startTime), appt.duration)
        ) {
          hasConflict = true;
          break;
        }
      }

      availableSlots.push({
        startTime,
        duration: 30,
        available: !hasConflict,
      });
    }
  }

  return {
    therapistId,
    therapistName: therapist.fullName,
    availableSlots,
  };
}

export async function rescheduleAppointment(
  context: AccessContext,
  appointmentId: string,
  newDate: string,
  newTime: string
): Promise<{ success: boolean; appointmentId: string }> {
  const appointment = appointments.get(appointmentId);
  if (!appointment) {
    throw new Error("APPOINTMENT_NOT_FOUND");
  }

  assertCanPerform(context, "appointment.update", appointment.department);

  // Check new slot is available
  const requestedSlotStart = timeToMinutes(newTime);
  for (const [id, appt] of appointments.entries()) {
    if (
      id !== appointmentId &&
      appt.therapistId === appointment.therapistId &&
      appt.date === newDate &&
      slotsOverlap(
        requestedSlotStart,
        appointment.duration,
        timeToMinutes(appt.startTime),
        appt.duration
      )
    ) {
      throw new Error("TIME_SLOT_CONFLICT");
    }
  }

  // Update appointment
  appointment.date = newDate;
  appointment.startTime = newTime;

  return {
    success: true,
    appointmentId,
  };
}

export async function cancelAppointment(
  context: AccessContext,
  appointmentId: string
): Promise<{ success: boolean; appointmentId: string }> {
  const appointment = appointments.get(appointmentId);
  if (!appointment) {
    throw new Error("APPOINTMENT_NOT_FOUND");
  }

  assertCanPerform(context, "appointment.update", appointment.department);

  appointments.delete(appointmentId);

  return {
    success: true,
    appointmentId,
  };
}

export async function getTodaysAppointments(
  context: AccessContext,
  department: "Physio" | "Dental"
): Promise<Array<{
  appointmentId: string;
  patientId: string;
  therapistName: string;
  date: string;
  startTime: string;
  duration: number;
}>> {
  assertCanPerform(context, "appointment.read", department);

  const directory = await getWebStaffDirectory();
  const now = dhakaClockParts();
  const todayAppointments = [];

  for (const [id, appt] of appointments.entries()) {
    if (appt.date === now.date && appt.department === department) {
      const therapist = directory.find((s) => s.staffId === appt.therapistId);
      todayAppointments.push({
        appointmentId: id,
        patientId: appt.patientId,
        therapistName: therapist?.fullName || "Unknown",
        date: appt.date,
        startTime: appt.startTime,
        duration: appt.duration,
      });
    }
  }

  return todayAppointments.sort((a, b) => a.startTime.localeCompare(b.startTime));
}
