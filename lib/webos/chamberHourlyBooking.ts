import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import {
  validatePhysioBooking,
  type BookingModalityOption,
  type BookingTimelineStep,
  type PhysioBookingInput,
} from "@/lib/webos/appointmentScheduling";
import { getPatientForContext } from "@/lib/webos/reception";
import {
  appendRowsWithAudit,
  type SheetCellValue,
  type SheetRowAppend,
} from "@/lib/webos/sheetTransaction";

const APPOINTMENT_SHEET = "04_Appointments";
const RESERVATION_SHEET = "25_Machine_Reservations";
const TIMELINE_SHEET = "26_Treatment_Timeline";
const CONFLICT_SHEET = "27_Booking_Conflicts";
const ACTIVE_STATUSES = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);
const TERMINAL_NON_OCCUPYING = new Set(["cancelled", "canceled", "no-show"]);
const ALLOWED_BEDS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);
const VALIDATION_VERSION = "chamber-hour-block-v1";

export type HourlyBedId = "BED-1" | "BED-2" | "BED-3" | "BED-4" | "TRACTION-BED";

export type HourlyBookingConflictType =
  | "invalid_slot"
  | "gender_required"
  | "bed_busy"
  | "gender_rule"
  | "therapist_busy"
  | "treatment_plan"
  | "machine_busy"
  | "duplicate"
  | "schema";

export interface HourlyBookingConflict {
  type: HourlyBookingConflictType;
  message: string;
}

export interface HourlyBookingValidation {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  requestedBedId: HourlyBedId;
  roomId: string;
  slotStartMinute: number;
  slotEndMinute: number;
  slotLabel: string;
  treatmentDurationMin: number;
  bedHoldDurationMin: number;
  timeline: BookingTimelineStep[];
  conflicts: HourlyBookingConflict[];
  suggestedModalities: string[];
  modalityOptions: BookingModalityOption[];
}

export interface HourlyBookingInput extends PhysioBookingInput {
  requestedBedId: string;
}

export interface HourlyBoardAppointment {
  appointmentId: string;
  date: string;
  time: string;
  startMinute: number;
  endMinute: number;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  assignedBedId: HourlyBedId | "";
  treatmentDurationMin: number;
  bedHoldDurationMin: number;
  modalities: string[];
}

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
  const mapped = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return headers.map((header) => mapped.get(normalized(header)) ?? "");
}

function ensureHeaders(headers: string[], required: string[]): void {
  const present = new Set(headers.map(normalized));
  if (required.some((name) => !present.has(name.toLowerCase()))) throw new Error("SCHEMA_MISMATCH");
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
      : [];
  } catch {
    return [];
  }
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function timeMinutes(value: string): number {
  const text = normalize(value).toUpperCase();
  const input = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (input) {
    const hour = Number(input[1]);
    const minute = Number(input[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  const sheet = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (sheet) {
    let hour = Number(sheet[1]) % 12;
    const minute = Number(sheet[2]);
    if (sheet[3] === "PM") hour += 12;
    if (minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  throw new Error("INVALID_TIME");
}

function inputTime(value: number): string {
  const minute = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function sheetTime(value: number): string {
  const minute = Math.max(0, Math.round(value));
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function shortHour(value: number): string {
  const hour24 = Math.floor(value / 60) % 24;
  const hour12 = hour24 % 12 || 12;
  return String(hour12);
}

function slotLabel(startMinute: number): string {
  return `${shortHour(startMinute)}–${shortHour(startMinute + 60)}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function bedId(value: unknown): HourlyBedId | "" {
  const text = normalized(value);
  if (["traction", "traction bed", "traction-bed"].includes(text)) return "TRACTION-BED";
  const match = /bed[-\s]*([1-4])/.exec(text);
  return match ? (`BED-${match[1]}` as HourlyBedId) : "";
}

function bedLabel(id: HourlyBedId): string {
  if (id === "TRACTION-BED") return "Traction Bed";
  return `Bed ${id.slice(-1)}`;
}

function roomForBed(id: HourlyBedId): string {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  return "Traction Room";
}

function flowFromRemarks(remarks: string): { gender: "Male" | "Female" | ""; bedId: HourlyBedId | "" } {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return { gender: "", bedId: "" };
  const fields = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) fields.set(key.trim().toLowerCase(), rest.join("=").trim());
  }
  return {
    gender: parseGender(fields.get("gender")),
    bedId: bedId(fields.get("bed") || fields.get("station")),
  };
}

function withFlowTag(
  remarks: string,
  gender: "Male" | "Female" | "",
  requestedBedId: HourlyBedId
): string {
  const clean = normalize(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const room = roomForBed(requestedBedId);
  const station = requestedBedId === "TRACTION-BED" ? "Traction" : "Treatment";
  const tag = `[PTFLOW gender=${gender};room=${room};bed=${bedLabel(requestedBedId)};station=${station}]`;
  return `${clean} ${tag}`.trim();
}

function nowDhaka(ref = new Date()): { display: string; iso: string } {
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
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    display: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`,
    iso: ref.toISOString(),
  };
}

function auditRow(
  context: AccessContext,
  action: string,
  entityType: string,
  entityId: string,
  patientId: string,
  after: string,
  reason: string,
  now = nowDhaka()
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
    after,
    reason,
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

function parseBoardAppointments(rows: string[][], date: string): HourlyBoardAppointment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idx("Appointment_ID"));
    if (!appointmentId || at(row, idx("Date")) !== date) return [];
    const status = at(row, idx("Status")) || "Scheduled";
    if (TERMINAL_NON_OCCUPYING.has(normalized(status))) return [];
    const remarks = at(row, idx("Remarks"));
    const flow = flowFromRemarks(remarks);
    const assignedBedId = bedId(at(row, idx("Assigned_Bed_ID"))) || flow.bedId;
    let startMinute = 0;
    try {
      startMinute = timeMinutes(at(row, idx("Time")));
    } catch {
      return [];
    }
    const expected = Number(at(row, idx("Expected_Duration_Min")) || 0);
    const treatmentDurationMin = Number.isFinite(expected) && expected > 0 ? expected : 60;
    const bedHoldDurationMin = Math.max(60, treatmentDurationMin);
    return [{
      appointmentId,
      date,
      time: at(row, idx("Time")),
      startMinute,
      endMinute: startMinute + bedHoldDurationMin,
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      therapist: at(row, idx("Therapist")),
      status,
      assignedBedId,
      treatmentDurationMin,
      bedHoldDurationMin,
      modalities: parseJsonArray(at(row, idx("Modalities_JSON"))),
    }];
  }).sort((a, b) => a.startMinute - b.startMinute);
}

async function loadAppointmentRows(): Promise<string[][]> {
  const snapshot = await fetchSheetRanges("physio", [APPOINTMENT_SHEET]);
  const rows = snapshot[APPOINTMENT_SHEET] || [];
  if (!rows.length) throw new Error("SCHEMA_MISMATCH");
  ensureHeaders(rows[0], [
    "Appointment_ID",
    "Date",
    "Time",
    "Patient_ID",
    "Therapist",
    "Status",
    "Remarks",
    "Assigned_Bed_ID",
    "Modalities_JSON",
    "Expected_Duration_Min",
  ]);
  return rows;
}

function requestedBedConflicts(
  appointments: HourlyBoardAppointment[],
  input: {
    patientId: string;
    therapist: string;
    gender: "Male" | "Female" | "";
    requestedBedId: HourlyBedId;
    slotStartMinute: number;
    slotEndMinute: number;
    planNeedsTraction: boolean;
  }
): HourlyBookingConflict[] {
  const conflicts: HourlyBookingConflict[] = [];
  const { patientId, therapist, gender, requestedBedId, slotStartMinute, slotEndMinute, planNeedsTraction } = input;
  if (!gender) {
    conflicts.push({ type: "gender_required", message: "Patient gender must be set before bed booking." });
    return conflicts;
  }
  if (planNeedsTraction && requestedBedId !== "TRACTION-BED") {
    conflicts.push({ type: "treatment_plan", message: "Active treatment plan requires the Traction Bed." });
  }

  const overlapping = appointments.filter(
    (item) => ACTIVE_STATUSES.has(normalized(item.status)) && overlaps(slotStartMinute, slotEndMinute, item.startMinute, item.endMinute)
  );
  if (overlapping.some((item) => item.patientId === patientId)) {
    conflicts.push({ type: "duplicate", message: "Patient already has an overlapping appointment in this hour." });
  }
  const sameTherapist = overlapping.find((item) => normalized(item.therapist) === normalized(therapist));
  if (therapist && sameTherapist) {
    conflicts.push({ type: "therapist_busy", message: `${therapist} already has ${sameTherapist.patientName || sameTherapist.patientId} in this hour.` });
  }
  const sameBed = overlapping.find((item) => item.assignedBedId === requestedBedId);
  if (sameBed) {
    conflicts.push({ type: "bed_busy", message: `${bedLabel(requestedBedId)} is already booked for ${sameBed.patientName || sameBed.patientId}.` });
  }
  if (requestedBedId !== "TRACTION-BED") {
    const room = roomForBed(requestedBedId);
    const roomGenders = new Set(
      overlapping
        .filter((item) => item.assignedBedId && item.assignedBedId !== "TRACTION-BED" && roomForBed(item.assignedBedId as HourlyBedId) === room)
        .map((item) => flowFromRemarks("").gender)
    );
    // Re-read genders directly from appointment rows is handled in validateRequestedBed below.
    if (roomGenders.size > 1) {
      conflicts.push({ type: "gender_rule", message: `${room} has inconsistent gender occupancy. Resolve before booking.` });
    }
  }
  return conflicts;
}

function appointmentGenderMap(rows: string[][]): Map<string, "Male" | "Female" | ""> {
  const result = new Map<string, "Male" | "Female" | "">();
  if (rows.length < 2) return result;
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const remarksIdx = headerIndex(headers, "Remarks");
  for (const row of rows.slice(1)) {
    const id = at(row, idIdx);
    if (id) result.set(id, flowFromRemarks(at(row, remarksIdx)).gender);
  }
  return result;
}

export async function getHourlyBedBoard(
  context: AccessContext,
  date: string
): Promise<HourlyBoardAppointment[]> {
  assertCanPerform(context, "chamber.read", "Physio");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  return parseBoardAppointments(await loadAppointmentRows(), date);
}

export async function validateHourlyBedBooking(
  context: AccessContext,
  input: HourlyBookingInput
): Promise<HourlyBookingValidation> {
  assertCanPerform(context, "appointment.create", "Physio");
  const requestedBedId = bedId(input.requestedBedId);
  if (!requestedBedId || !ALLOWED_BEDS.has(requestedBedId)) throw new Error("INVALID_BED");
  const slotStartMinute = timeMinutes(input.time);
  if (slotStartMinute % 60 !== 0) throw new Error("INVALID_SLOT");
  const slotEndMinute = slotStartMinute + 60;
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const therapist = normalize(input.therapist);
  if (!therapist) throw new Error("INVALID_THERAPIST");

  const [patient, base, appointmentRows] = await Promise.all([
    getPatientForContext(context, input.patientId),
    validatePhysioBooking(context, input),
    loadAppointmentRows(),
  ]);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const appointments = parseBoardAppointments(appointmentRows, date);
  const genderByAppointment = appointmentGenderMap(appointmentRows);
  const gender = parseGender(patient.gender);
  const conflicts: HourlyBookingConflict[] = base.conflicts
    .filter((item) => item.type === "machine_busy" || item.type === "duplicate" || item.type === "schema")
    .map((item) => ({
      type: item.type === "machine_busy" ? "machine_busy" : item.type === "duplicate" ? "duplicate" : "schema",
      message: item.message,
    }));

  conflicts.push(...requestedBedConflicts(appointments, {
    patientId: patient.patientId,
    therapist,
    gender,
    requestedBedId,
    slotStartMinute,
    slotEndMinute,
    planNeedsTraction: base.needsTraction,
  }));

  if (requestedBedId !== "TRACTION-BED" && gender) {
    const room = roomForBed(requestedBedId);
    const overlappingRoom = appointments.filter(
      (item) =>
        ACTIVE_STATUSES.has(normalized(item.status)) &&
        item.assignedBedId &&
        item.assignedBedId !== "TRACTION-BED" &&
        roomForBed(item.assignedBedId as HourlyBedId) === room &&
        overlaps(slotStartMinute, slotEndMinute, item.startMinute, item.endMinute)
    );
    const genders = new Set(overlappingRoom.map((item) => genderByAppointment.get(item.appointmentId)).filter(Boolean));
    if (genders.size > 1) {
      conflicts.push({ type: "gender_rule", message: `${room} already has mixed-gender data. Resolve it before booking.` });
    } else if (genders.size === 1 && !genders.has(gender)) {
      conflicts.push({ type: "gender_rule", message: `${room} is currently locked for ${[...genders][0]}. Choose the other room/bed.` });
    }
  }

  const uniqueConflicts = [...new Map(conflicts.map((item) => [`${item.type}:${item.message}`, item])).values()];
  return {
    isValid: uniqueConflicts.length === 0,
    patientId: patient.patientId,
    patientName: patient.fullName,
    gender,
    requestedBedId,
    roomId: roomForBed(requestedBedId),
    slotStartMinute,
    slotEndMinute,
    slotLabel: slotLabel(slotStartMinute),
    treatmentDurationMin: base.totalDurationMin,
    bedHoldDurationMin: Math.max(60, base.totalDurationMin),
    timeline: base.timeline,
    conflicts: uniqueConflicts,
    suggestedModalities: base.suggestedModalities,
    modalityOptions: base.modalityOptions,
  };
}

async function recordConflict(
  context: AccessContext,
  input: HourlyBookingInput,
  validation: HourlyBookingValidation,
  conflictHeaders: string[]
): Promise<void> {
  const now = nowDhaka();
  const conflictId = `BCF${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const row = rowForHeaders(conflictHeaders, {
    Conflict_ID: conflictId,
    Attempted_At: now.display,
    Patient_ID: validation.patientId,
    Patient_Name: validation.patientName,
    Date: input.date,
    Time: sheetTime(validation.slotStartMinute),
    Therapist: normalize(input.therapist),
    Conflict_Type: validation.conflicts[0]?.type || "other",
    Detail: `${bedLabel(validation.requestedBedId)} · ${validation.conflicts.map((item) => item.message).join(" | ")}`,
    Suggested_Slots_JSON: "[]",
    Modalities_JSON: JSON.stringify(input.modalities || []),
    Expected_Duration_Min: validation.bedHoldDurationMin,
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
    auditRow(context, "appointment.hour_slot_conflict", "BookingConflict", conflictId, validation.patientId, JSON.stringify(validation.conflicts), "Chamber one-hour bed slot rejected", now)
  );
}

export async function createHourlyBedBooking(
  context: AccessContext,
  input: HourlyBookingInput
): Promise<{ appointmentId: string; validation: HourlyBookingValidation }> {
  assertCanPerform(context, "appointment.create", "Physio");
  const validation = await validateHourlyBedBooking(context, input);
  const snapshot = await fetchSheetRanges("physio", [
    APPOINTMENT_SHEET,
    RESERVATION_SHEET,
    TIMELINE_SHEET,
    CONFLICT_SHEET,
  ]);
  const appointmentRows = snapshot[APPOINTMENT_SHEET] || [];
  const reservationRows = snapshot[RESERVATION_SHEET] || [];
  const timelineRows = snapshot[TIMELINE_SHEET] || [];
  const conflictRows = snapshot[CONFLICT_SHEET] || [];
  if (![appointmentRows, reservationRows, timelineRows, conflictRows].every((rows) => rows.length > 0)) throw new Error("SCHEMA_MISMATCH");
  if (!validation.isValid) {
    await recordConflict(context, input, validation, conflictRows[0]);
    const error = new Error(`APPOINTMENT_CONFLICT:${validation.conflicts[0]?.type || "other"}:${validation.conflicts[0]?.message || "Booking conflict"}`);
    (error as Error & { validation?: HourlyBookingValidation }).validation = validation;
    throw error;
  }

  const patient = await getPatientForContext(context, validation.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const appointmentHeaders = appointmentRows[0];
  const reservationHeaders = reservationRows[0];
  const timelineHeaders = timelineRows[0];
  ensureHeaders(appointmentHeaders, ["Appointment_ID", "Assigned_Bed_ID", "Modalities_JSON", "Expected_Duration_Min", "Timeline_ID"]);
  const existingIdIdx = headerIndex(appointmentHeaders, "Appointment_ID");
  const existingIds = new Set(appointmentRows.slice(1).map((row) => at(row, existingIdIdx)));
  let appointmentId = "";
  for (let attempt = 0; attempt < 8 && !appointmentId; attempt += 1) {
    const candidate = `APW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existingIds.has(candidate)) appointmentId = candidate;
  }
  if (!appointmentId) throw new Error("ID_ALLOCATION_FAILED");

  const timelineId = `TLW${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const now = nowDhaka();
  const selectedModalities = Array.from(new Set((input.modalities || []).filter((value) => validation.modalityOptions.some((item) => item.value === value))));
  const remarks = withFlowTag(input.remarks || "", validation.gender, validation.requestedBedId);
  const appointmentRow = rowForHeaders(appointmentHeaders, {
    Appointment_ID: appointmentId,
    Date: normalize(input.date),
    Time: sheetTime(validation.slotStartMinute),
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Department: "Physio",
    Therapist: normalize(input.therapist),
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
    Assigned_Bed_ID: validation.requestedBedId,
    Modalities_JSON: JSON.stringify(selectedModalities),
    Expected_Duration_Min: validation.bedHoldDurationMin,
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
        Date: normalize(input.date),
        Assigned_Bed_ID: validation.requestedBedId,
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
          Date: normalize(input.date),
          Assigned_Bed_ID: validation.requestedBedId,
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
        date: input.date,
        slot: validation.slotLabel,
        requestedBedId: validation.requestedBedId,
        therapist: input.therapist,
        modalities: selectedModalities,
        treatmentDurationMin: validation.treatmentDurationMin,
        bedHoldDurationMin: validation.bedHoldDurationMin,
      }),
      "Chamber one-hour bed slot booking",
      now
    )
  );
  return { appointmentId, validation };
}

export function chamberHourSlots(): Array<{ startMinute: number; time: string; label: string }> {
  const slots: Array<{ startMinute: number; time: string; label: string }> = [];
  for (let hour = 10; hour < 21; hour += 1) {
    const startMinute = hour * 60;
    slots.push({ startMinute, time: inputTime(startMinute), label: slotLabel(startMinute) });
  }
  return slots;
}
