import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import type { PatientRecord } from "@/lib/patients";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext } from "@/lib/webos/reception";
import { appendRowsWithAudit, type SheetCellValue, type SheetRowAppend } from "@/lib/webos/sheetTransaction";

const APPOINTMENT_SHEET = "04_Appointments";
const PLAN_SHEET = "12_Treatment_Plans";
const RESOURCE_SHEET = "24_Chamber_Resources";
const RESERVATION_SHEET = "25_Machine_Reservations";
const TIMELINE_SHEET = "26_Treatment_Timeline";
const CONFLICT_SHEET = "27_Booking_Conflicts";
const VALIDATION_VERSION = "booking-v1";
const ACTIVE_APPOINTMENT_STATUSES = new Set([
  "scheduled",
  "received",
  "arrived",
  "waiting",
  "in treatment",
]);

const ROOM_BEDS: Record<string, string[]> = {
  "Room 1": ["BED-1", "BED-2"],
  "Room 2": ["BED-3", "BED-4"],
};

export interface BookingModalityOption {
  value: string;
  label: string;
  durationMin: number;
  resourceId: string;
  resourceName: string;
  machine: boolean;
}

export interface BookingTimelineStep {
  sequence: number;
  name: string;
  durationMin: number;
  resourceId: string;
  resourceName: string;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
}

export interface BookingConflict {
  type: "machine_busy" | "gender_rule" | "no_bed" | "gender_required" | "duplicate" | "schema";
  message: string;
  resourceId?: string;
  busyUntil?: string;
}

export interface BookingSuggestion {
  time: string;
  timeLabel: string;
  assignedBedId: string;
  roomId: string;
  totalDurationMin: number;
  reason: string;
}

export interface BookingValidationResult {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  assignedBedId: string;
  roomId: string;
  station: "Treatment" | "Traction" | "";
  totalDurationMin: number;
  timeline: BookingTimelineStep[];
  conflicts: BookingConflict[];
  suggestions: BookingSuggestion[];
  suggestedModalities: string[];
  needsTraction: boolean;
  modalityOptions: BookingModalityOption[];
}

export interface PhysioBookingInput {
  patientId: string;
  date: string;
  time: string;
  therapist: string;
  remarks?: string;
  modalities?: string[];
}

export interface AppointmentBookingMeta {
  appointmentId: string;
  assignedBedId: string;
  modalities: string[];
  expectedDurationMin: number;
  timelineId: string;
}

export interface ChamberBookingPlanSummary {
  appointmentId: string;
  patientId: string;
  patientName: string;
  assignedBedId: string;
  startTime: string;
  expectedDurationMin: number;
  steps: BookingTimelineStep[];
}

export interface MachineReservationSummary {
  reservationId: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  assignedBedId: string;
  resourceId: string;
  resourceName: string;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
  status: string;
}

type RawAppointment = {
  appointmentId: string;
  date: string;
  time: string;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  remarks: string;
  assignedBedId: string;
  modalities: string[];
  expectedDurationMin: number;
  timelineId: string;
  gender: "Male" | "Female" | "";
};

type MachineReservation = MachineReservationSummary & { date: string };

type SchedulingState = {
  appointmentRows: string[][];
  planRows: string[][];
  resourceRows: string[][];
  reservationRows: string[][];
  timelineRows: string[][];
  conflictRows: string[][];
  appointments: RawAppointment[];
  reservations: MachineReservation[];
  options: BookingModalityOption[];
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalized);
  for (const name of names) {
    const index = values.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(headers: string[], values: Record<string, SheetCellValue>): SheetCellValue[] {
  const map = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function ensureHeaders(headers: string[], required: string[]): void {
  const available = new Set(headers.map(normalized));
  if (required.some((name) => !available.has(name.toLowerCase()))) throw new Error("SCHEMA_MISMATCH");
}

function parseBoolean(value: unknown): boolean {
  return ["true", "1", "yes", "y", "on"].includes(normalized(value));
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
  } catch {
    return [];
  }
}

function timeInputMinutes(value: string): number {
  const text = normalize(value);
  const input = /^(\d{2}):(\d{2})$/.exec(text);
  if (input) {
    const hour = Number(input[1]);
    const minute = Number(input[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  const sheet = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text);
  if (sheet) {
    let hour = Number(sheet[1]) % 12;
    const minute = Number(sheet[2]);
    if (sheet[3].toUpperCase() === "PM") hour += 12;
    if (minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  throw new Error("INVALID_TIME");
}

function inputTimeFromMinutes(value: number): string {
  const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function sheetTimeFromMinutes(value: number): string {
  const minutes = Math.max(0, Math.round(value));
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function flowTagFields(remarks: string): { gender: "Male" | "Female" | ""; room: string; bed: string; station: string } {
  const result = { gender: "" as "Male" | "Female" | "", room: "", bed: "", station: "" };
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return result;
  const values = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) values.set(key.trim().toLowerCase(), rest.join("=").trim());
  }
  result.gender = parseGender(values.get("gender"));
  result.room = values.get("room") || "";
  result.bed = values.get("bed") || "";
  result.station = values.get("station") || "";
  return result;
}

function bedIdFromValue(value: string): string {
  const text = normalized(value);
  if (!text) return "";
  if (text === "traction-bed" || text === "traction bed" || text === "traction") return "TRACTION-BED";
  const match = /bed[-\s]*([1-4])/.exec(text);
  return match ? `BED-${match[1]}` : "";
}

function roomForBed(bedId: string): string {
  if (["BED-1", "BED-2"].includes(bedId)) return "Room 1";
  if (["BED-3", "BED-4"].includes(bedId)) return "Room 2";
  if (bedId === "TRACTION-BED") return "Traction Room";
  return "";
}

function bedLabel(bedId: string): string {
  if (bedId === "TRACTION-BED") return "Traction Bed";
  const match = /^BED-([1-4])$/.exec(bedId);
  return match ? `Bed ${match[1]}` : bedId;
}

function withFlowTag(
  remarks: string,
  input: { gender: "Male" | "Female" | ""; roomId: string; bedId: string; station: "Treatment" | "Traction" }
): string {
  const clean = normalize(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const tag = `[PTFLOW gender=${input.gender};room=${input.roomId};bed=${bedLabel(input.bedId)};station=${input.station}]`;
  return `${clean} ${tag}`.trim();
}

function nowDhaka(ref = new Date()): { date: string; display: string; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${v.year}-${v.month}-${v.day}`;
  return { date, display: `${date} ${v.hour}:${v.minute}:${v.second}`, iso: ref.toISOString() };
}

function parseResources(rows: string[][]): BookingModalityOption[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Resource_ID");
  const nameIdx = headerIndex(headers, "Resource_Name");
  const typeIdx = headerIndex(headers, "Resource_Type");
  const enabledIdx = headerIndex(headers, "Enabled");
  const departmentIdx = headerIndex(headers, "Department");
  const durationIdx = headerIndex(headers, "Default_Duration_Min");
  const options = rows.slice(1).flatMap((row) => {
    const resourceId = at(row, idIdx);
    const resourceName = at(row, nameIdx);
    const resourceType = normalized(at(row, typeIdx));
    const department = normalized(at(row, departmentIdx));
    const durationMin = Number(at(row, durationIdx) || 0);
    if (!resourceId || !resourceName || resourceType !== "machine" || department !== "physio") return [];
    if (!parseBoolean(at(row, enabledIdx)) || !Number.isFinite(durationMin) || durationMin <= 0) return [];
    return [{
      value: resourceId,
      label: resourceName,
      durationMin,
      resourceId,
      resourceName,
      machine: true,
    }];
  });
  options.push({
    value: "MANUAL",
    label: "Manual Therapy",
    durationMin: 10,
    resourceId: "",
    resourceName: "",
    machine: false,
  });
  return options;
}

function suggestedFromPlan(
  rows: string[][],
  patientId: string,
  options: BookingModalityOption[]
): { modalities: string[]; needsTraction: boolean } {
  if (rows.length < 2) return { modalities: [], needsTraction: false };
  const headers = rows[0];
  const patientIdx = headerIndex(headers, "Patient_ID");
  const statusIdx = headerIndex(headers, "Status");
  const electroIdx = headerIndex(headers, "Electrotherapy_Plan");
  const manualIdx = headerIndex(headers, "Manual_Therapy_Plan");
  const active = rows.slice(1).filter(
    (row) => at(row, patientIdx) === patientId && normalized(at(row, statusIdx) || "Active") === "active"
  );
  const row = active[active.length - 1];
  if (!row) return { modalities: [], needsTraction: false };
  const electro = normalized(at(row, electroIdx));
  const manual = normalized(at(row, manualIdx));
  const combined = `${electro} ${manual}`;
  const aliases: Array<[RegExp, string]> = [
    [/\bfacial\s*tens\b/i, "Facial TENS"],
    [/\bshockwave\b|\bsk5\b/i, "Shockwave SK5"],
    [/\bultrasound\b|\bust\b|\bu\.?s\.?t\.?\b/i, "Ultrasound"],
    [/\btens\b/i, "TENS"],
    [/\bift\b/i, "IFT"],
    [/\bems\b/i, "EMS"],
    [/\bswd\b|short\s*wave/i, "SWD"],
    [/\bwax\b/i, "Wax"],
    [/\birr\b|infra\s*red/i, "IRR"],
  ];
  const selected: string[] = [];
  for (const [pattern, label] of aliases) {
    if (!pattern.test(combined)) continue;
    const option = options.find((item) => normalized(item.label) === normalized(label));
    if (option && !selected.includes(option.value)) selected.push(option.value);
  }
  if (/mfr|mobil|mulligan|massage|stretch|dtfm|release|manual|mackenzie|glid|soft\s*tissue|istm/i.test(manual)) {
    selected.push("MANUAL");
  }
  return { modalities: selected, needsTraction: /\btraction\b/i.test(combined) };
}

function buildTimeline(
  startMinute: number,
  selectedValues: string[],
  options: BookingModalityOption[]
): BookingTimelineStep[] {
  const selected = selectedValues.flatMap((value) => {
    const option = options.find((item) => item.value === value);
    return option ? [option] : [];
  });
  if (selected.length === 0) {
    return [{
      sequence: 1,
      name: "General session",
      durationMin: 30,
      resourceId: "",
      resourceName: "",
      startMinute,
      endMinute: startMinute + 30,
      startTime: sheetTimeFromMinutes(startMinute),
      endTime: sheetTimeFromMinutes(startMinute + 30),
    }];
  }
  const definitions: Array<{ name: string; durationMin: number; resourceId: string; resourceName: string }> = [
    { name: "Positioning", durationMin: 1, resourceId: "", resourceName: "" },
    { name: "Warmup", durationMin: 5, resourceId: "", resourceName: "" },
  ];
  selected.forEach((option, index) => {
    if (index > 0) definitions.push({ name: "Transition", durationMin: 1, resourceId: "", resourceName: "" });
    definitions.push({
      name: option.label,
      durationMin: option.durationMin,
      resourceId: option.resourceId,
      resourceName: option.resourceName,
    });
  });
  definitions.push({ name: "Rest", durationMin: 1, resourceId: "", resourceName: "" });
  let cursor = startMinute;
  return definitions.map((step, index) => {
    const start = cursor;
    const end = start + step.durationMin;
    cursor = end;
    return {
      sequence: index + 1,
      name: step.name,
      durationMin: step.durationMin,
      resourceId: step.resourceId,
      resourceName: step.resourceName,
      startMinute: start,
      endMinute: end,
      startTime: sheetTimeFromMinutes(start),
      endTime: sheetTimeFromMinutes(end),
    };
  });
}

function parseAppointments(rows: string[][]): RawAppointment[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idx("Appointment_ID"));
    if (!appointmentId) return [];
    const remarks = at(row, idx("Remarks"));
    const flow = flowTagFields(remarks);
    const assignedBedId = bedIdFromValue(at(row, idx("Assigned_Bed_ID"))) || bedIdFromValue(flow.bed || flow.station);
    return [{
      appointmentId,
      date: at(row, idx("Date")),
      time: at(row, idx("Time")),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      therapist: at(row, idx("Therapist")),
      status: at(row, idx("Status")) || "Scheduled",
      remarks,
      assignedBedId,
      modalities: parseJsonArray(at(row, idx("Modalities_JSON"))),
      expectedDurationMin: Math.max(1, Number(at(row, idx("Expected_Duration_Min")) || 30)),
      timelineId: at(row, idx("Timeline_ID")),
      gender: flow.gender,
    }];
  });
}

function parseReservations(rows: string[][]): MachineReservation[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const reservationId = at(row, idx("Reservation_ID"));
    if (!reservationId) return [];
    return [{
      reservationId,
      appointmentId: at(row, idx("Appointment_ID")),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      date: at(row, idx("Date")),
      assignedBedId: at(row, idx("Assigned_Bed_ID")),
      resourceId: at(row, idx("Resource_ID")),
      resourceName: at(row, idx("Resource_Name")),
      startMinute: Number(at(row, idx("Start_Minute")) || 0),
      endMinute: Number(at(row, idx("End_Minute")) || 0),
      startTime: at(row, idx("Start_Time")),
      endTime: at(row, idx("End_Time")),
      status: at(row, idx("Status")) || "Scheduled",
    }];
  });
}

async function loadState(): Promise<SchedulingState> {
  const snapshot = await fetchSheetRanges("physio", [
    APPOINTMENT_SHEET,
    PLAN_SHEET,
    RESOURCE_SHEET,
    RESERVATION_SHEET,
    TIMELINE_SHEET,
    CONFLICT_SHEET,
  ]);
  const appointmentRows = snapshot[APPOINTMENT_SHEET] || [];
  const planRows = snapshot[PLAN_SHEET] || [];
  const resourceRows = snapshot[RESOURCE_SHEET] || [];
  const reservationRows = snapshot[RESERVATION_SHEET] || [];
  const timelineRows = snapshot[TIMELINE_SHEET] || [];
  const conflictRows = snapshot[CONFLICT_SHEET] || [];
  if ([appointmentRows, resourceRows, reservationRows, timelineRows, conflictRows].some((rows) => rows.length === 0)) {
    throw new Error("SCHEMA_MISMATCH");
  }
  ensureHeaders(appointmentRows[0], [
    "Appointment_ID",
    "Date",
    "Time",
    "Patient_ID",
    "Department",
    "Status",
    "Assigned_Bed_ID",
    "Modalities_JSON",
    "Expected_Duration_Min",
    "Timeline_ID",
    "Booking_Validation_Version",
  ]);
  ensureHeaders(resourceRows[0], ["Resource_ID", "Resource_Name", "Resource_Type", "Enabled", "Default_Duration_Min"]);
  ensureHeaders(reservationRows[0], ["Reservation_ID", "Appointment_ID", "Date", "Resource_ID", "Start_Minute", "End_Minute", "Status"]);
  ensureHeaders(timelineRows[0], ["Timeline_Step_ID", "Timeline_ID", "Appointment_ID", "Sequence", "Step_Name", "Duration_Min"]);
  ensureHeaders(conflictRows[0], ["Conflict_ID", "Patient_ID", "Conflict_Type", "Detail"]);
  return {
    appointmentRows,
    planRows,
    resourceRows,
    reservationRows,
    timelineRows,
    conflictRows,
    appointments: parseAppointments(appointmentRows),
    reservations: parseReservations(reservationRows),
    options: parseResources(resourceRows),
  };
}

function appointmentActive(status: string): boolean {
  return ACTIVE_APPOINTMENT_STATUSES.has(normalized(status));
}

function evaluateBed(
  state: SchedulingState,
  patient: PatientRecord,
  date: string,
  startMinute: number,
  durationMin: number,
  needsTraction: boolean
): { bedId: string; roomId: string; station: "Treatment" | "Traction" | ""; conflict?: BookingConflict } {
  const gender = parseGender(patient.gender);
  const endMinute = startMinute + durationMin;
  const overlappingAppointments = state.appointments.filter((item) => {
    if (item.date !== date || !appointmentActive(item.status) || !item.assignedBedId) return false;
    let existingStart: number;
    try {
      existingStart = timeInputMinutes(item.time);
    } catch {
      return false;
    }
    return overlaps(startMinute, endMinute, existingStart, existingStart + item.expectedDurationMin);
  });

  if (needsTraction) {
    const busy = overlappingAppointments.find((item) => item.assignedBedId === "TRACTION-BED");
    if (busy) {
      return {
        bedId: "",
        roomId: "Traction Room",
        station: "Traction",
        conflict: { type: "no_bed", message: `Traction Bed busy with ${busy.patientName || busy.patientId}` },
      };
    }
    return { bedId: "TRACTION-BED", roomId: "Traction Room", station: "Traction" };
  }

  if (!gender) {
    return {
      bedId: "",
      roomId: "",
      station: "",
      conflict: { type: "gender_required", message: "Patient gender must be set before Physio bed booking." },
    };
  }

  const occupiedBeds = new Set<string>();
  const roomGenders = new Map<string, Set<"Male" | "Female">>([
    ["Room 1", new Set<"Male" | "Female">()],
    ["Room 2", new Set<"Male" | "Female">()],
  ]);
  for (const item of overlappingAppointments) {
    const bedId = item.assignedBedId;
    if (!/^BED-[1-4]$/.test(bedId)) continue;
    occupiedBeds.add(bedId);
    const roomId = roomForBed(bedId);
    if (item.gender) roomGenders.get(roomId)?.add(item.gender);
  }

  for (const [roomId, genders] of roomGenders.entries()) {
    if (genders.size > 1) {
      return {
        bedId: "",
        roomId,
        station: "",
        conflict: { type: "gender_rule", message: `${roomId} already has a mixed-gender state. Resolve chamber data before booking.` },
      };
    }
  }

  const preferredRooms = [
    ...Object.keys(ROOM_BEDS).filter((roomId) => {
      const genders = roomGenders.get(roomId) || new Set();
      return genders.size === 1 && genders.has(gender);
    }),
    ...Object.keys(ROOM_BEDS).filter((roomId) => (roomGenders.get(roomId)?.size || 0) === 0),
  ];
  for (const roomId of preferredRooms) {
    for (const bedId of ROOM_BEDS[roomId]) {
      if (!occupiedBeds.has(bedId)) return { bedId, roomId, station: "Treatment" };
    }
  }
  return {
    bedId: "",
    roomId: "",
    station: "",
    conflict: {
      type: "gender_rule",
      message: `No gender-compatible treatment bed is free for ${gender}. This would mix genders within a treatment room or exceed capacity.`,
    },
  };
}

function evaluateMachines(
  state: SchedulingState,
  date: string,
  timeline: BookingTimelineStep[]
): BookingConflict[] {
  const statusByAppointment = new Map(state.appointments.map((item) => [item.appointmentId, item.status]));
  const activeReservations = state.reservations.filter((reservation) => {
    if (reservation.date !== date) return false;
    if (!["scheduled", "active"].includes(normalized(reservation.status))) return false;
    const appointmentStatus = statusByAppointment.get(reservation.appointmentId);
    return appointmentStatus ? appointmentActive(appointmentStatus) : true;
  });
  const conflicts: BookingConflict[] = [];
  for (const step of timeline) {
    if (!step.resourceId) continue;
    const busy = activeReservations.find(
      (reservation) =>
        reservation.resourceId === step.resourceId &&
        overlaps(step.startMinute, step.endMinute, reservation.startMinute, reservation.endMinute)
    );
    if (busy) {
      conflicts.push({
        type: "machine_busy",
        resourceId: step.resourceId,
        busyUntil: busy.endTime || sheetTimeFromMinutes(busy.endMinute),
        message: `${step.resourceName || step.name} is reserved for ${busy.patientName || busy.patientId} until ${busy.endTime || sheetTimeFromMinutes(busy.endMinute)}.`,
      });
    }
  }
  return conflicts;
}

function duplicateConflict(
  state: SchedulingState,
  patientId: string,
  date: string,
  startMinute: number,
  durationMin: number
): BookingConflict | null {
  const endMinute = startMinute + durationMin;
  const duplicate = state.appointments.find((item) => {
    if (item.patientId !== patientId || item.date !== date || !appointmentActive(item.status)) return false;
    try {
      const existingStart = timeInputMinutes(item.time);
      return overlaps(startMinute, endMinute, existingStart, existingStart + item.expectedDurationMin);
    } catch {
      return false;
    }
  });
  return duplicate
    ? { type: "duplicate", message: `Patient already has an overlapping appointment at ${duplicate.time}.` }
    : null;
}

function evaluateAt(
  state: SchedulingState,
  patient: PatientRecord,
  date: string,
  startMinute: number,
  selectedModalities: string[],
  needsTraction: boolean
): Omit<BookingValidationResult, "suggestions" | "suggestedModalities" | "modalityOptions"> {
  const timeline = buildTimeline(startMinute, selectedModalities, state.options);
  const totalDurationMin = timeline.length ? timeline[timeline.length - 1].endMinute - startMinute : 30;
  const conflicts: BookingConflict[] = [];
  const duplicate = duplicateConflict(state, patient.patientId, date, startMinute, totalDurationMin);
  if (duplicate) conflicts.push(duplicate);
  const bed = evaluateBed(state, patient, date, startMinute, totalDurationMin, needsTraction);
  if (bed.conflict) conflicts.push(bed.conflict);
  conflicts.push(...evaluateMachines(state, date, timeline));
  return {
    isValid: conflicts.length === 0,
    patientId: patient.patientId,
    patientName: patient.fullName,
    gender: parseGender(patient.gender),
    assignedBedId: bed.bedId,
    roomId: bed.roomId,
    station: bed.station,
    totalDurationMin,
    timeline,
    conflicts,
    needsTraction,
  };
}

function suggestionsFor(
  state: SchedulingState,
  patient: PatientRecord,
  date: string,
  requestedStart: number,
  selectedModalities: string[],
  needsTraction: boolean
): BookingSuggestion[] {
  const suggestions: BookingSuggestion[] = [];
  for (let candidate = requestedStart + 5; candidate < 24 * 60 && candidate <= requestedStart + 240; candidate += 5) {
    const result = evaluateAt(state, patient, date, candidate, selectedModalities, needsTraction);
    if (!result.isValid || !result.assignedBedId) continue;
    suggestions.push({
      time: inputTimeFromMinutes(candidate),
      timeLabel: sheetTimeFromMinutes(candidate),
      assignedBedId: result.assignedBedId,
      roomId: result.roomId,
      totalDurationMin: result.totalDurationMin,
      reason: "Gender-safe bed and selected machines are available.",
    });
    if (suggestions.length >= 4) break;
  }
  return suggestions;
}

async function patientForBooking(context: AccessContext, patientId: string): Promise<PatientRecord> {
  const patient = await getPatientForContext(context, patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  assertCanPerform(context, "appointment.create", "Physio");
  return patient;
}

export async function getBookingModalityOptions(context: AccessContext): Promise<BookingModalityOption[]> {
  assertCanPerform(context, "appointment.create", "Physio");
  const snapshot = await fetchSheetRanges("physio", [RESOURCE_SHEET]);
  return parseResources(snapshot[RESOURCE_SHEET] || []);
}

export async function getBookingProfile(
  context: AccessContext,
  patientId: string
): Promise<{ suggestedModalities: string[]; needsTraction: boolean; modalityOptions: BookingModalityOption[] }> {
  const patient = await patientForBooking(context, patientId);
  const snapshot = await fetchSheetRanges("physio", [PLAN_SHEET, RESOURCE_SHEET]);
  const options = parseResources(snapshot[RESOURCE_SHEET] || []);
  const suggestion = suggestedFromPlan(snapshot[PLAN_SHEET] || [], patient.patientId, options);
  return { suggestedModalities: suggestion.modalities, needsTraction: suggestion.needsTraction, modalityOptions: options };
}

export async function validatePhysioBooking(
  context: AccessContext,
  input: PhysioBookingInput
): Promise<BookingValidationResult> {
  const patient = await patientForBooking(context, input.patientId);
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const startMinute = timeInputMinutes(input.time);
  const state = await loadState();
  const plan = suggestedFromPlan(state.planRows, patient.patientId, state.options);
  const selectedModalities = Array.from(new Set((input.modalities || []).filter((value) => state.options.some((item) => item.value === value))));
  const result = evaluateAt(state, patient, date, startMinute, selectedModalities, plan.needsTraction);
  const suggestions = result.isValid
    ? []
    : suggestionsFor(state, patient, date, startMinute, selectedModalities, plan.needsTraction);
  return {
    ...result,
    suggestions,
    suggestedModalities: plan.modalities,
    modalityOptions: state.options,
  };
}

function auditRow(
  context: AccessContext,
  action: string,
  entityType: string,
  entityId: string,
  patientId: string,
  afterValue: string,
  now: ReturnType<typeof nowDhaka>
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.display,
    context.staffId,
    action,
    entityType,
    entityId,
    patientId,
    "",
    afterValue,
    "Booking machine/bed reservation engine",
    "RELIFE",
    "RELIFE-PHYSIO",
    "AMTALI-01",
    `RELIFE-PHYSIO:${entityId}`,
    "",
    context.staffId,
    "web_pwa",
    "human_entry",
    false,
    true,
    "relife-uda-v1",
    now.iso,
    "Physio",
  ];
}

async function recordConflict(
  context: AccessContext,
  state: SchedulingState,
  patient: PatientRecord,
  input: PhysioBookingInput,
  validation: BookingValidationResult
): Promise<void> {
  const now = nowDhaka();
  const conflictId = `BCF${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const primary = validation.conflicts[0];
  const row = rowForHeaders(state.conflictRows[0], {
    Conflict_ID: conflictId,
    Attempted_At: now.display,
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Date: input.date,
    Time: sheetTimeFromMinutes(timeInputMinutes(input.time)),
    Therapist: normalize(input.therapist),
    Conflict_Type: primary?.type || "other",
    Resource_ID: primary?.resourceId || "",
    Detail: validation.conflicts.map((item) => item.message).join(" | "),
    Suggested_Slots_JSON: JSON.stringify(validation.suggestions),
    Modalities_JSON: JSON.stringify(input.modalities || []),
    Expected_Duration_Min: validation.totalDurationMin,
    Actor_ID: context.staffId,
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Department: "Physio",
    Record_ID: `RELIFE-PHYSIO:${conflictId}`,
    Source_System: "web_pwa",
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
  });
  await appendRowsWithAudit(
    "physio",
    [{ sheet: CONFLICT_SHEET, row }],
    auditRow(context, "appointment.booking_conflict", "BookingConflict", conflictId, patient.patientId, JSON.stringify(validation.conflicts), now)
  );
}

export async function createPhysioBooking(
  context: AccessContext,
  input: PhysioBookingInput
): Promise<{ appointmentId: string; validation: BookingValidationResult }> {
  const patient = await patientForBooking(context, input.patientId);
  const therapist = normalize(input.therapist);
  if (!therapist) throw new Error("INVALID_THERAPIST");
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const startMinute = timeInputMinutes(input.time);
  const state = await loadState();
  const plan = suggestedFromPlan(state.planRows, patient.patientId, state.options);
  const selectedModalities = Array.from(new Set((input.modalities || []).filter((value) => state.options.some((item) => item.value === value))));
  const evaluated = evaluateAt(state, patient, date, startMinute, selectedModalities, plan.needsTraction);
  const validation: BookingValidationResult = {
    ...evaluated,
    suggestions: evaluated.isValid ? [] : suggestionsFor(state, patient, date, startMinute, selectedModalities, plan.needsTraction),
    suggestedModalities: plan.modalities,
    modalityOptions: state.options,
  };
  if (!validation.isValid) {
    await recordConflict(context, state, patient, input, validation);
    const primary = validation.conflicts[0];
    const error = new Error(`APPOINTMENT_CONFLICT:${primary?.type || "other"}:${primary?.message || "Booking conflict"}`);
    (error as Error & { validation?: BookingValidationResult }).validation = validation;
    throw error;
  }

  const appointmentHeaders = state.appointmentRows[0];
  const reservationHeaders = state.reservationRows[0];
  const timelineHeaders = state.timelineRows[0];
  const idIdx = headerIndex(appointmentHeaders, "Appointment_ID");
  const existingIds = new Set(state.appointmentRows.slice(1).map((row) => at(row, idIdx)));
  let appointmentId = "";
  for (let attempt = 0; attempt < 8 && !appointmentId; attempt += 1) {
    const candidate = `APW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existingIds.has(candidate)) appointmentId = candidate;
  }
  if (!appointmentId) throw new Error("ID_ALLOCATION_FAILED");
  const timelineId = `TLW${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const now = nowDhaka();
  const remarks = withFlowTag(input.remarks || "", {
    gender: validation.gender,
    roomId: validation.roomId,
    bedId: validation.assignedBedId,
    station: validation.station === "Traction" ? "Traction" : "Treatment",
  });
  const appointmentRow = rowForHeaders(appointmentHeaders, {
    Appointment_ID: appointmentId,
    Date: date,
    Time: sheetTimeFromMinutes(startMinute),
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Department: "Physio",
    Therapist: therapist,
    Status: "Scheduled",
    Remarks: remarks,
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${appointmentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.iso,
    Received_By: context.staffId,
    Assigned_Bed_ID: validation.assignedBedId,
    Modalities_JSON: JSON.stringify(selectedModalities),
    Expected_Duration_Min: validation.totalDurationMin,
    Timeline_ID: timelineId,
    Booking_Validation_Version: VALIDATION_VERSION,
  });

  const appends: SheetRowAppend[] = [{ sheet: APPOINTMENT_SHEET, row: appointmentRow }];
  for (const step of validation.timeline) {
    const stepId = `TLS${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    appends.push({
      sheet: TIMELINE_SHEET,
      row: rowForHeaders(timelineHeaders, {
        Timeline_Step_ID: stepId,
        Timeline_ID: timelineId,
        Appointment_ID: appointmentId,
        Patient_ID: patient.patientId,
        Patient_Name: patient.fullName,
        Date: date,
        Assigned_Bed_ID: validation.assignedBedId,
        Sequence: step.sequence,
        Step_Name: step.name,
        Resource_ID: step.resourceId,
        Resource_Name: step.resourceName,
        Duration_Min: step.durationMin,
        Start_Minute: step.startMinute,
        End_Minute: step.endMinute,
        Start_Time: step.startTime,
        End_Time: step.endTime,
        Status: "Planned",
        Created_At: now.display,
        Updated_At: now.display,
        Created_By: context.staffId,
        Organization_ID: "RELIFE",
        Clinic_ID: "RELIFE-PHYSIO",
        Branch_ID: "AMTALI-01",
        Department: "Physio",
        Record_ID: `RELIFE-PHYSIO:${stepId}`,
        Source_System: "web_pwa",
        Human_Verified: true,
        Schema_Version: "relife-uda-v1",
      }),
    });
    if (step.resourceId) {
      const reservationId = `RSV${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
      appends.push({
        sheet: RESERVATION_SHEET,
        row: rowForHeaders(reservationHeaders, {
          Reservation_ID: reservationId,
          Appointment_ID: appointmentId,
          Patient_ID: patient.patientId,
          Patient_Name: patient.fullName,
          Date: date,
          Assigned_Bed_ID: validation.assignedBedId,
          Resource_ID: step.resourceId,
          Resource_Name: step.resourceName,
          Sequence: step.sequence,
          Start_Minute: step.startMinute,
          End_Minute: step.endMinute,
          Start_Time: step.startTime,
          End_Time: step.endTime,
          Duration_Min: step.durationMin,
          Status: "Scheduled",
          Created_At: now.display,
          Updated_At: now.display,
          Created_By: context.staffId,
          Organization_ID: "RELIFE",
          Clinic_ID: "RELIFE-PHYSIO",
          Branch_ID: "AMTALI-01",
          Department: "Physio",
          Record_ID: `RELIFE-PHYSIO:${reservationId}`,
          Source_System: "web_pwa",
          Human_Verified: true,
          Schema_Version: "relife-uda-v1",
        }),
      });
    }
  }
  await appendRowsWithAudit(
    "physio",
    appends,
    auditRow(
      context,
      "appointment.create",
      "Appointment",
      appointmentId,
      patient.patientId,
      JSON.stringify({
        appointmentId,
        patientId: patient.patientId,
        date,
        time: sheetTimeFromMinutes(startMinute),
        therapist,
        assignedBedId: validation.assignedBedId,
        modalities: selectedModalities,
        durationMin: validation.totalDurationMin,
        timelineId,
      }),
      now
    )
  );
  return { appointmentId, validation };
}

export async function getAppointmentBookingMetadata(
  context: AccessContext,
  appointmentIds: string[]
): Promise<Record<string, AppointmentBookingMeta>> {
  assertCanPerform(context, "appointment.read", "Physio");
  if (appointmentIds.length === 0) return {};
  const snapshot = await fetchSheetRanges("physio", [APPOINTMENT_SHEET]);
  const appointments = parseAppointments(snapshot[APPOINTMENT_SHEET] || []);
  const wanted = new Set(appointmentIds);
  return Object.fromEntries(
    appointments
      .filter((item) => wanted.has(item.appointmentId))
      .map((item) => [item.appointmentId, {
        appointmentId: item.appointmentId,
        assignedBedId: item.assignedBedId,
        modalities: item.modalities,
        expectedDurationMin: item.expectedDurationMin,
        timelineId: item.timelineId,
      }])
  );
}

function parseTimeline(rows: string[][], date: string): Map<string, BookingTimelineStep[]> {
  const result = new Map<string, BookingTimelineStep[]>();
  if (rows.length < 2) return result;
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  for (const row of rows.slice(1)) {
    if (at(row, idx("Date")) !== date) continue;
    const appointmentId = at(row, idx("Appointment_ID"));
    if (!appointmentId) continue;
    const step: BookingTimelineStep = {
      sequence: Number(at(row, idx("Sequence")) || 0),
      name: at(row, idx("Step_Name")),
      durationMin: Number(at(row, idx("Duration_Min")) || 0),
      resourceId: at(row, idx("Resource_ID")),
      resourceName: at(row, idx("Resource_Name")),
      startMinute: Number(at(row, idx("Start_Minute")) || 0),
      endMinute: Number(at(row, idx("End_Minute")) || 0),
      startTime: at(row, idx("Start_Time")),
      endTime: at(row, idx("End_Time")),
    };
    result.set(appointmentId, [...(result.get(appointmentId) || []), step]);
  }
  for (const [key, steps] of result.entries()) result.set(key, steps.sort((a, b) => a.sequence - b.sequence));
  return result;
}

export async function getChamberBookingPlans(
  context: AccessContext,
  date: string
): Promise<{ plans: ChamberBookingPlanSummary[]; reservations: MachineReservationSummary[] }> {
  assertCanPerform(context, "chamber.read", "Physio");
  const state = await loadState();
  const timelineByAppointment = parseTimeline(state.timelineRows, date);
  const activeAppointments = state.appointments.filter((item) => item.date === date && appointmentActive(item.status));
  const plans = activeAppointments.flatMap((item) => {
    const steps = timelineByAppointment.get(item.appointmentId) || [];
    if (steps.length === 0) return [];
    return [{
      appointmentId: item.appointmentId,
      patientId: item.patientId,
      patientName: item.patientName,
      assignedBedId: item.assignedBedId,
      startTime: item.time,
      expectedDurationMin: item.expectedDurationMin,
      steps,
    }];
  });
  const activeIds = new Set(activeAppointments.map((item) => item.appointmentId));
  const reservations = state.reservations
    .filter((item) => item.date === date && activeIds.has(item.appointmentId))
    .sort((a, b) => a.startMinute - b.startMinute);
  return { plans, reservations };
}
