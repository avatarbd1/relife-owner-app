import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext } from "@/lib/webos/reception";
import { appendRowsWithAudit, type SheetCellValue, type SheetRowAppend } from "@/lib/webos/sheetTransaction";

const APPOINTMENT_SHEET = "04_Appointments";
const PLAN_SHEET = "12_Treatment_Plans";
const RESOURCE_SHEET = "24_Chamber_Resources";
const RESERVATION_SHEET = "25_Machine_Reservations";
const TIMELINE_SHEET = "26_Treatment_Timeline";
const CONFLICT_SHEET = "27_Booking_Conflicts";
const ACTIVE = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);
const BEDS = new Set(["BED-1", "BED-2", "BED-3", "BED-4", "TRACTION-BED"]);
const MANUAL_ID = "MANUAL";
const SESSION_MINUTES = 60;

export type FixedBedId = "BED-1" | "BED-2" | "BED-3" | "BED-4" | "TRACTION-BED";

export interface FixedModalityOption {
  value: string;
  label: string;
  durationMin: number;
  resourceId: string;
  machine: boolean;
}

export interface FixedPlanStep {
  sequence: number;
  name: string;
  value: string;
  resourceId: string;
  durationMin: number;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
}

export interface FixedHourConflict {
  type: "gender_required" | "bed_busy" | "gender_rule" | "therapist_busy" | "duplicate" | "machine_busy" | "duration_overflow" | "treatment_plan" | "schema";
  message: string;
}

export interface FixedHourValidation {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  requestedBedId: FixedBedId;
  roomId: string;
  slotStartMinute: number;
  slotEndMinute: number;
  slotLabel: string;
  totalSelectedMin: number;
  remainingMin: number;
  timeline: FixedPlanStep[];
  conflicts: FixedHourConflict[];
  modalityOptions: FixedModalityOption[];
  suggestedModalities: string[];
  needsTraction: boolean;
}

export interface FixedHourInput {
  patientId: string;
  date: string;
  time: string;
  therapist: string;
  requestedBedId: string;
  modalities?: string[];
  remarks?: string;
}

type Appointment = {
  appointmentId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  bedId: FixedBedId | "";
  gender: "Male" | "Female" | "";
};

type Reservation = {
  appointmentId: string;
  date: string;
  resourceId: string;
  startMinute: number;
  endMinute: number;
  status: string;
  patientName: string;
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
  const mapped = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return headers.map((header) => mapped.get(normalized(header)) ?? "");
}

function ensureHeaders(headers: string[], required: string[]): void {
  const present = new Set(headers.map(normalized));
  if (required.some((name) => !present.has(name.toLowerCase()))) throw new Error("SCHEMA_MISMATCH");
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function parseBoolean(value: unknown): boolean {
  return ["true", "1", "yes", "y", "on"].includes(normalized(value));
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []) : [];
  } catch {
    return [];
  }
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

function sheetTime(value: number): string {
  const minute = Math.max(0, Math.round(value));
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function slotLabel(start: number): string {
  const hour = (value: number) => String((Math.floor(value / 60) % 12) || 12);
  return `${hour(start)}–${hour(start + 60)}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function bedId(value: unknown): FixedBedId | "" {
  const text = normalized(value);
  if (["traction", "traction bed", "traction-bed"].includes(text)) return "TRACTION-BED";
  const match = /bed[-\s]*([1-4])/.exec(text);
  return match ? (`BED-${match[1]}` as FixedBedId) : "";
}

function bedLabel(id: FixedBedId): string {
  return id === "TRACTION-BED" ? "Traction Bed" : `Bed ${id.slice(-1)}`;
}

function roomForBed(id: FixedBedId): string {
  if (id === "BED-1" || id === "BED-2") return "Room 1";
  if (id === "BED-3" || id === "BED-4") return "Room 2";
  return "Traction Room";
}

function flowFields(remarks: string): { gender: "Male" | "Female" | ""; bedId: FixedBedId | "" } {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return { gender: "", bedId: "" };
  const values = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) values.set(key.trim().toLowerCase(), rest.join("=").trim());
  }
  return {
    gender: parseGender(values.get("gender")),
    bedId: bedId(values.get("bed") || values.get("station")),
  };
}

function withFlowTag(remarks: string, gender: "Male" | "Female" | "", requestedBedId: FixedBedId): string {
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

function auditRow(context: AccessContext, action: string, entityType: string, entityId: string, patientId: string, after: string, reason: string, now = nowDhaka()): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`, now.display, context.staffId, action, entityType, entityId, patientId, "", after, reason,
    "RELIFE", "RELIFE-PHYSIO", "AMTALI-01", `RELIFE-PHYSIO:${entityId}`, "", context.staffId,
    "web_pwa", "human_entry", false, true, "relife-uda-v1", now.iso, "Physio",
  ];
}

function parseResources(rows: string[][]): FixedModalityOption[] {
  if (rows.length < 2) return [{ value: MANUAL_ID, label: "Manual Therapy", durationMin: 10, resourceId: "", machine: false }];
  const h = rows[0];
  const idIdx = headerIndex(h, "Resource_ID");
  const nameIdx = headerIndex(h, "Resource_Name");
  const typeIdx = headerIndex(h, "Resource_Type");
  const enabledIdx = headerIndex(h, "Enabled");
  const departmentIdx = headerIndex(h, "Department");
  const durationIdx = headerIndex(h, "Default_Duration_Min");
  const result = rows.slice(1).flatMap((row) => {
    const resourceId = at(row, idIdx);
    const label = at(row, nameIdx);
    const durationMin = Number(at(row, durationIdx) || 0);
    if (!resourceId || !label || normalized(at(row, typeIdx)) !== "machine") return [];
    if (normalized(at(row, departmentIdx)) !== "physio" || !parseBoolean(at(row, enabledIdx))) return [];
    if (!Number.isFinite(durationMin) || durationMin <= 0) return [];
    return [{ value: resourceId, label, durationMin, resourceId, machine: true }];
  });
  result.push({ value: MANUAL_ID, label: "Manual Therapy", durationMin: 10, resourceId: "", machine: false });
  return result;
}

function planSuggestion(rows: string[][], patientId: string, options: FixedModalityOption[]): { modalities: string[]; needsTraction: boolean } {
  if (rows.length < 2) return { modalities: [], needsTraction: false };
  const h = rows[0];
  const patientIdx = headerIndex(h, "Patient_ID");
  const statusIdx = headerIndex(h, "Status");
  const electroIdx = headerIndex(h, "Electrotherapy_Plan");
  const manualIdx = headerIndex(h, "Manual_Therapy_Plan");
  const exerciseIdx = headerIndex(h, "Exercise_Plan");
  const active = rows.slice(1).filter((row) => at(row, patientIdx) === patientId && normalized(at(row, statusIdx) || "Active") === "active");
  const row = active[active.length - 1];
  if (!row) return { modalities: [], needsTraction: false };
  const electro = `${at(row, electroIdx)} ${at(row, manualIdx)}`;
  const combined = `${electro} ${at(row, exerciseIdx)}`;
  const aliases: Array<[RegExp, string]> = [
    [/facial\s*tens/i, "Facial TENS"], [/shockwave|sk5/i, "Shockwave SK5"], [/ultrasound|\bust\b/i, "Ultrasound"],
    [/\bift\b/i, "IFT"], [/\btens\b/i, "TENS"], [/\bems\b/i, "EMS"], [/\bswd\b|short\s*wave/i, "SWD"],
    [/\bwax\b/i, "Wax"], [/\birr\b|infra\s*red/i, "IRR"],
  ];
  const modalities: string[] = [];
  for (const [pattern, label] of aliases) {
    if (!pattern.test(electro)) continue;
    const option = options.find((item) => normalized(item.label) === normalized(label));
    if (option && !modalities.includes(option.value)) modalities.push(option.value);
  }
  if (/manual|mobil|mulligan|massage|mfr|soft\s*tissue|release|dtfm|istm/i.test(at(row, manualIdx))) modalities.push(MANUAL_ID);
  return { modalities: [...new Set(modalities)], needsTraction: /\btraction\b/i.test(combined) };
}

function buildTimeline(startMinute: number, selected: string[], options: FixedModalityOption[]): { timeline: FixedPlanStep[]; totalSelectedMin: number; remainingMin: number } {
  const chosen = selected.flatMap((value) => {
    const option = options.find((item) => item.value === value);
    return option ? [option] : [];
  });
  const totalSelectedMin = chosen.reduce((sum, option) => sum + option.durationMin, 0);
  let cursor = startMinute;
  const timeline: FixedPlanStep[] = chosen.map((option, index) => {
    const start = cursor;
    const end = start + option.durationMin;
    cursor = end;
    return {
      sequence: index + 1, name: option.label, value: option.value, resourceId: option.resourceId,
      durationMin: option.durationMin, startMinute: start, endMinute: end, startTime: sheetTime(start), endTime: sheetTime(end),
    };
  });
  const remainingMin = Math.max(0, SESSION_MINUTES - totalSelectedMin);
  if (remainingMin > 0) {
    timeline.push({
      sequence: timeline.length + 1,
      name: chosen.length ? "Therapist time" : "Therapist session",
      value: "THERAPIST-TIME",
      resourceId: "",
      durationMin: remainingMin,
      startMinute: cursor,
      endMinute: cursor + remainingMin,
      startTime: sheetTime(cursor),
      endTime: sheetTime(cursor + remainingMin),
    });
  }
  return { timeline, totalSelectedMin, remainingMin };
}

function parseAppointments(rows: string[][]): Appointment[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idx("Appointment_ID"));
    if (!appointmentId) return [];
    let startMinute = 0;
    try { startMinute = timeMinutes(at(row, idx("Time"))); } catch { return []; }
    const remarks = at(row, idx("Remarks"));
    const flow = flowFields(remarks);
    return [{
      appointmentId,
      date: at(row, idx("Date")),
      startMinute,
      endMinute: startMinute + Math.max(60, Number(at(row, idx("Expected_Duration_Min")) || 60)),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      therapist: at(row, idx("Therapist")),
      status: at(row, idx("Status")) || "Scheduled",
      bedId: bedId(at(row, idx("Assigned_Bed_ID"))) || flow.bedId,
      gender: flow.gender,
    }];
  });
}

function parseReservations(rows: string[][]): Reservation[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idx("Appointment_ID"));
    const resourceId = at(row, idx("Resource_ID"));
    if (!appointmentId || !resourceId) return [];
    return [{
      appointmentId,
      date: at(row, idx("Date")),
      resourceId,
      startMinute: Number(at(row, idx("Start_Minute")) || 0),
      endMinute: Number(at(row, idx("End_Minute")) || 0),
      status: at(row, idx("Status")) || "Scheduled",
      patientName: at(row, idx("Patient_Name")),
    }];
  });
}

async function loadState() {
  const snapshot = await fetchSheetRanges("physio", [APPOINTMENT_SHEET, PLAN_SHEET, RESOURCE_SHEET, RESERVATION_SHEET, TIMELINE_SHEET, CONFLICT_SHEET]);
  const appointmentRows = snapshot[APPOINTMENT_SHEET] || [];
  const planRows = snapshot[PLAN_SHEET] || [];
  const resourceRows = snapshot[RESOURCE_SHEET] || [];
  const reservationRows = snapshot[RESERVATION_SHEET] || [];
  const timelineRows = snapshot[TIMELINE_SHEET] || [];
  const conflictRows = snapshot[CONFLICT_SHEET] || [];
  if (![appointmentRows, resourceRows, reservationRows, timelineRows, conflictRows].every((rows) => rows.length > 0)) throw new Error("SCHEMA_MISMATCH");
  ensureHeaders(appointmentRows[0], ["Appointment_ID", "Date", "Time", "Patient_ID", "Therapist", "Status", "Remarks", "Assigned_Bed_ID", "Modalities_JSON", "Expected_Duration_Min", "Timeline_ID"]);
  ensureHeaders(resourceRows[0], ["Resource_ID", "Resource_Name", "Resource_Type", "Enabled", "Default_Duration_Min"]);
  ensureHeaders(reservationRows[0], ["Reservation_ID", "Appointment_ID", "Date", "Resource_ID", "Start_Minute", "End_Minute", "Status"]);
  ensureHeaders(timelineRows[0], ["Timeline_Step_ID", "Timeline_ID", "Appointment_ID", "Sequence", "Step_Name", "Duration_Min"]);
  ensureHeaders(conflictRows[0], ["Conflict_ID", "Patient_ID", "Conflict_Type", "Detail"]);
  const appointments = parseAppointments(appointmentRows);
  return {
    appointmentRows, planRows, resourceRows, reservationRows, timelineRows, conflictRows,
    appointments,
    reservations: parseReservations(reservationRows),
    options: parseResources(resourceRows),
  };
}

function activeAppointment(status: string): boolean {
  return ACTIVE.has(normalized(status));
}

export async function validateFixedHourBooking(context: AccessContext, input: FixedHourInput): Promise<FixedHourValidation> {
  assertCanPerform(context, "appointment.create", "Physio");
  const requestedBedId = bedId(input.requestedBedId);
  if (!requestedBedId || !BEDS.has(requestedBedId)) throw new Error("INVALID_BED");
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const slotStartMinute = timeMinutes(input.time);
  if (slotStartMinute % 60 !== 0) throw new Error("INVALID_SLOT");
  const slotEndMinute = slotStartMinute + SESSION_MINUTES;
  const therapist = normalize(input.therapist);
  if (!therapist) throw new Error("INVALID_THERAPIST");
  const patient = await getPatientForContext(context, input.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const state = await loadState();
  const gender = parseGender(patient.gender);
  const suggestion = planSuggestion(state.planRows, patient.patientId, state.options);
  const selected = [...new Set((input.modalities || []).filter((value) => state.options.some((item) => item.value === value)))];
  const plan = buildTimeline(slotStartMinute, selected, state.options);
  const conflicts: FixedHourConflict[] = [];

  if (!gender) conflicts.push({ type: "gender_required", message: "Patient gender must be set before Chamber booking." });
  if (plan.totalSelectedMin > SESSION_MINUTES) conflicts.push({ type: "duration_overflow", message: `Selected treatment is ${plan.totalSelectedMin} min. Maximum is 60 min for this slot.` });
  if (suggestion.needsTraction && requestedBedId !== "TRACTION-BED") conflicts.push({ type: "treatment_plan", message: "Active treatment plan requires the Traction Bed." });

  const overlapping = state.appointments.filter((item) => item.date === date && activeAppointment(item.status) && overlaps(slotStartMinute, slotEndMinute, item.startMinute, item.endMinute));
  if (overlapping.some((item) => item.patientId === patient.patientId)) conflicts.push({ type: "duplicate", message: "Patient already has an overlapping appointment in this hour." });
  const therapistBusy = overlapping.find((item) => normalized(item.therapist) === normalized(therapist));
  if (therapistBusy) conflicts.push({ type: "therapist_busy", message: `${therapist} already has ${therapistBusy.patientName || therapistBusy.patientId} in this hour.` });
  const bedBusy = overlapping.find((item) => item.bedId === requestedBedId);
  if (bedBusy) conflicts.push({ type: "bed_busy", message: `${bedLabel(requestedBedId)} is already booked for ${bedBusy.patientName || bedBusy.patientId}.` });

  if (requestedBedId !== "TRACTION-BED" && gender) {
    const room = roomForBed(requestedBedId);
    const roomGenders = new Set(overlapping.filter((item) => item.bedId && item.bedId !== "TRACTION-BED" && roomForBed(item.bedId as FixedBedId) === room).map((item) => item.gender).filter(Boolean));
    if (roomGenders.size > 1) conflicts.push({ type: "gender_rule", message: `${room} already has mixed-gender data. Resolve it first.` });
    else if (roomGenders.size === 1 && !roomGenders.has(gender)) conflicts.push({ type: "gender_rule", message: `${room} is locked for ${[...roomGenders][0]} during this hour.` });
  }

  const statusByAppointment = new Map(state.appointments.map((item) => [item.appointmentId, item.status]));
  const reservations = state.reservations.filter((item) => {
    if (item.date !== date || !["scheduled", "active"].includes(normalized(item.status))) return false;
    const appointmentStatus = statusByAppointment.get(item.appointmentId);
    return appointmentStatus ? activeAppointment(appointmentStatus) : true;
  });
  for (const step of plan.timeline) {
    if (!step.resourceId) continue;
    const busy = reservations.find((item) => item.resourceId === step.resourceId && overlaps(step.startMinute, step.endMinute, item.startMinute, item.endMinute));
    if (busy) conflicts.push({ type: "machine_busy", message: `${step.name} is reserved for ${busy.patientName || "another patient"} during ${step.startTime}–${step.endTime}.` });
  }

  const unique = [...new Map(conflicts.map((item) => [`${item.type}:${item.message}`, item])).values()];
  return {
    isValid: unique.length === 0,
    patientId: patient.patientId,
    patientName: patient.fullName,
    gender,
    requestedBedId,
    roomId: roomForBed(requestedBedId),
    slotStartMinute,
    slotEndMinute,
    slotLabel: slotLabel(slotStartMinute),
    totalSelectedMin: plan.totalSelectedMin,
    remainingMin: plan.remainingMin,
    timeline: plan.timeline,
    conflicts: unique,
    modalityOptions: state.options,
    suggestedModalities: suggestion.modalities,
    needsTraction: suggestion.needsTraction,
  };
}

async function recordConflict(context: AccessContext, input: FixedHourInput, validation: FixedHourValidation, headers: string[]): Promise<void> {
  const now = nowDhaka();
  const conflictId = `BCF${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const row = rowForHeaders(headers, {
    Conflict_ID: conflictId,
    Attempted_At: now.display,
    Patient_ID: validation.patientId,
    Patient_Name: validation.patientName,
    Date: input.date,
    Time: sheetTime(validation.slotStartMinute),
    Therapist: normalize(input.therapist),
    Conflict_Type: validation.conflicts[0]?.type || "other",
    Detail: validation.conflicts.map((item) => item.message).join(" | "),
    Suggested_Slots_JSON: "[]",
    Modalities_JSON: JSON.stringify(input.modalities || []),
    Expected_Duration_Min: SESSION_MINUTES,
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
  await appendRowsWithAudit("physio", [{ sheet: CONFLICT_SHEET, row }], auditRow(context, "appointment.fixed_hour_conflict", "BookingConflict", conflictId, validation.patientId, JSON.stringify(validation.conflicts), "Chamber fixed-hour booking rejected", now));
}

export async function createFixedHourBooking(context: AccessContext, input: FixedHourInput): Promise<{ appointmentId: string; validation: FixedHourValidation }> {
  const validation = await validateFixedHourBooking(context, input);
  const state = await loadState();
  if (!validation.isValid) {
    await recordConflict(context, input, validation, state.conflictRows[0]);
    const error = new Error(`APPOINTMENT_CONFLICT:${validation.conflicts[0]?.type || "other"}:${validation.conflicts[0]?.message || "Booking conflict"}`);
    (error as Error & { validation?: FixedHourValidation }).validation = validation;
    throw error;
  }
  const patient = await getPatientForContext(context, validation.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const appointmentHeaders = state.appointmentRows[0];
  const reservationHeaders = state.reservationRows[0];
  const timelineHeaders = state.timelineRows[0];
  const idIdx = headerIndex(appointmentHeaders, "Appointment_ID");
  const existing = new Set(state.appointmentRows.slice(1).map((row) => at(row, idIdx)));
  let appointmentId = "";
  for (let attempt = 0; attempt < 8 && !appointmentId; attempt += 1) {
    const candidate = `APW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existing.has(candidate)) appointmentId = candidate;
  }
  if (!appointmentId) throw new Error("ID_ALLOCATION_FAILED");
  const timelineId = `TLW${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const now = nowDhaka();
  const selected = [...new Set((input.modalities || []).filter((value) => validation.modalityOptions.some((item) => item.value === value)))];
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
    Modalities_JSON: JSON.stringify(selected),
    Expected_Duration_Min: SESSION_MINUTES,
    Timeline_ID: timelineId,
    Booking_Validation_Version: "chamber-fixed-hour-v1",
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
        Resource_Name: step.resourceId ? step.name : "",
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
          Resource_Name: step.name,
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

  await appendRowsWithAudit("physio", appends, auditRow(context, "appointment.create_fixed_hour", "Appointment", appointmentId, patient.patientId, JSON.stringify({ appointmentId, bed: validation.requestedBedId, slot: validation.slotLabel, modalities: selected, timeline: validation.timeline.map((step) => ({ name: step.name, durationMin: step.durationMin })) }), "Chamber fixed 60-minute booking", now));
  return { appointmentId, validation };
}
