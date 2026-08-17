import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import {
  therapistIntervalsForTimeline,
  therapistIntervalsOverlap,
  type TherapistInterval,
  type TherapistTimelineStepLike,
} from "@/lib/domain/appointments/therapistCapacityRules";
import type {
  BookingConflict,
  BookingSuggestion,
  BookingTimelineStep,
  BookingValidationResult,
  PhysioBookingInput,
} from "@/lib/webos/appointmentScheduling";

const ACTIVE = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);

interface ExistingAppointment {
  appointmentId: string;
  patientId: string;
  patientName: string;
  therapist: string;
  date: string;
  startMinute: number;
  durationMin: number;
  status: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], ...names: string[]): number {
  const lookup = headers.map(normalized);
  for (const name of names) {
    const index = lookup.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function timeMinutes(value: unknown): number {
  const text = normalize(value);
  const input = /^(\d{2}):(\d{2})$/.exec(text);
  if (input) return Number(input[1]) * 60 + Number(input[2]);
  const sheet = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text);
  if (!sheet) return Number.NaN;
  let hour = Number(sheet[1]) % 12;
  if (sheet[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(sheet[2]);
}

function minuteLabel(value: number): string {
  const hour24 = Math.floor(value / 60) % 24;
  const minute = value % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parseAppointments(rows: string[][]): ExistingAppointment[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idx("Appointment_ID"));
    const startMinute = timeMinutes(at(row, idx("Time")));
    if (!appointmentId || !Number.isFinite(startMinute)) return [];
    return [{
      appointmentId,
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      therapist: at(row, idx("Therapist")),
      date: at(row, idx("Date")),
      startMinute,
      durationMin: Math.max(1, Number(at(row, idx("Expected_Duration_Min")) || 30)),
      status: at(row, idx("Status")) || "Scheduled",
    }];
  });
}

function parseTimeline(rows: string[][], date: string): Map<string, TherapistTimelineStepLike[]> {
  const result = new Map<string, TherapistTimelineStepLike[]>();
  if (rows.length < 2) return result;
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  for (const row of rows.slice(1)) {
    if (at(row, idx("Date")) !== date) continue;
    const appointmentId = at(row, idx("Appointment_ID"));
    if (!appointmentId) continue;
    const step = {
      name: at(row, idx("Step_Name")),
      resourceId: at(row, idx("Resource_ID")),
      startMinute: Number(at(row, idx("Start_Minute")) || 0),
      endMinute: Number(at(row, idx("End_Minute")) || 0),
    };
    result.set(appointmentId, [...(result.get(appointmentId) || []), step]);
  }
  return result;
}

function candidateIntervals(timeline: BookingTimelineStep[]): TherapistInterval[] {
  return therapistIntervalsForTimeline(
    timeline.map((step) => ({
      name: step.name,
      resourceId: step.resourceId,
      startMinute: step.startMinute,
      endMinute: step.endMinute,
    }))
  );
}

function shiftedIntervals(
  intervals: TherapistInterval[],
  delta: number
): TherapistInterval[] {
  return intervals.map((item) => ({
    startMinute: item.startMinute + delta,
    endMinute: item.endMinute + delta,
  }));
}

function conflictFor(
  appointments: ExistingAppointment[],
  timeline: Map<string, TherapistTimelineStepLike[]>,
  input: PhysioBookingInput,
  intervals: TherapistInterval[]
): BookingConflict | null {
  if (!normalize(input.therapist) || intervals.length === 0) return null;
  const therapist = normalized(input.therapist);
  for (const existing of appointments) {
    if (
      existing.date !== normalize(input.date) ||
      existing.patientId === normalize(input.patientId) ||
      normalized(existing.therapist) !== therapist ||
      !ACTIVE.has(normalized(existing.status))
    ) {
      continue;
    }

    const storedSteps = timeline.get(existing.appointmentId) || [];
    const existingIntervals = therapistIntervalsForTimeline(storedSteps, {
      startMinute: existing.startMinute,
      endMinute: existing.startMinute + existing.durationMin,
    });
    const overlap = therapistIntervalsOverlap(intervals, existingIntervals);
    if (!overlap) continue;

    return {
      type: "therapist_busy" as BookingConflict["type"],
      busyUntil: minuteLabel(overlap.endMinute),
      message: `${normalize(input.therapist)} is already needed by ${existing.patientName || existing.patientId} during ${minuteLabel(overlap.startMinute)}–${minuteLabel(overlap.endMinute)}.`,
    };
  }
  return null;
}

function filterSuggestions(
  suggestions: BookingSuggestion[],
  requestedStart: number,
  intervals: TherapistInterval[],
  appointments: ExistingAppointment[],
  timeline: Map<string, TherapistTimelineStepLike[]>,
  input: PhysioBookingInput
): BookingSuggestion[] {
  if (suggestions.length === 0 || intervals.length === 0) return suggestions;
  return suggestions.filter((suggestion) => {
    const suggestedStart = timeMinutes(suggestion.time);
    if (!Number.isFinite(suggestedStart)) return false;
    return !conflictFor(
      appointments,
      timeline,
      input,
      shiftedIntervals(intervals, suggestedStart - requestedStart)
    );
  });
}

export async function applyTherapistCapacityValidation(
  input: PhysioBookingInput,
  validation: BookingValidationResult
): Promise<BookingValidationResult> {
  const therapist = normalize(input.therapist);
  if (!therapist) return validation;
  const intervals = candidateIntervals(validation.timeline);
  if (intervals.length === 0) return validation;

  const snapshot = await fetchSheetRanges("physio", ["04_Appointments", "26_Treatment_Timeline"]);
  const appointments = parseAppointments(snapshot["04_Appointments"] || []);
  const timeline = parseTimeline(snapshot["26_Treatment_Timeline"] || [], normalize(input.date));
  const conflict = conflictFor(appointments, timeline, input, intervals);
  if (!conflict) return validation;

  let requestedStart = timeMinutes(input.time);
  if (!Number.isFinite(requestedStart)) requestedStart = validation.timeline[0]?.startMinute || 0;
  return {
    ...validation,
    isValid: false,
    conflicts: [...validation.conflicts, conflict],
    suggestions: filterSuggestions(
      validation.suggestions,
      requestedStart,
      intervals,
      appointments,
      timeline,
      input
    ),
  };
}
