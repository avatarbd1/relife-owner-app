import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { resolveConfiguredBooking } from "@/lib/domain/appointments/configuredBooking";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext } from "@/lib/webos/reception";
import {
  appendRowsWithAudit,
  type SheetCellValue,
} from "@/lib/webos/sheetTransaction";

const APPOINTMENT_SHEET = "04_Appointments";
const PLAN_SHEET = "12_Treatment_Plans";
const RESOURCE_SHEET = "24_Chamber_Resources";
const GENERAL_TOLERANCE_MIN = 5;
const TRACTION_EXPECTED_MIN = 20;
const VALIDATION_VERSION = "configured-booking-v2";
const ACTIVE = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);

export type CapacityConflictType = "gender_required" | "capacity" | "duplicate" | "schema";

export interface CapacityConflict {
  type: CapacityConflictType;
  message: string;
}

export interface CapacityWarning {
  type: "machine_demand" | "therapist_load" | "legacy_allocation";
  message: string;
}

export interface ExpectedDemand {
  resourceId: string;
  resourceName: string;
  durationMin: number;
  expectedThisHour: number;
}

export interface CapacityBookingInput {
  patientId: string;
  date: string;
  time: string;
  therapist?: string;
  remarks?: string;
  resourceCode?: string;
}

export interface CapacityBookingValidation {
  isValid: boolean;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  roomId: string;
  sessionMinutes: number;
  toleranceMinutes: number;
  conflicts: CapacityConflict[];
  warnings: CapacityWarning[];
  expectedDemand: ExpectedDemand[];
  clinicTimezone: string;
}

type ResourceOption = {
  resourceId: string;
  resourceName: string;
  durationMin: number;
};

type Appointment = {
  appointmentId: string;
  date: string;
  startMinute: number;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  roomId: string;
  gender: "Male" | "Female" | "";
  modalities: string[];
  organizationId: string;
  clinicId: string;
  resourceCode: string | null;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], ...names: string[]): number {
  const source = headers.map(normalized);
  for (const name of names) {
    const index = source.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
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
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
      : [];
  } catch {
    return [];
  }
}

function timeMinutes(value: string): number {
  const text = normalize(value).toUpperCase();
  const input = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
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
  const minute = Math.max(0, Math.min(1439, Math.round(value)));
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function flowFields(remarks: string): { gender: "Male" | "Female" | ""; roomId: string } {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return { gender: "", roomId: "" };
  const values = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) values.set(key.trim().toLowerCase(), rest.join("=").trim());
  }
  return {
    gender: parseGender(values.get("gender")),
    roomId: normalize(values.get("room")),
  };
}

function rowForHeaders(headers: string[], values: Record<string, SheetCellValue>): SheetCellValue[] {
  const mapped = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return headers.map((header) => mapped.get(normalized(header)) ?? "");
}

function ensureHeaders(headers: string[], required: string[]): void {
  const present = new Set(headers.map(normalized));
  if (required.some((name) => !present.has(name.toLowerCase()))) throw new Error("SCHEMA_MISMATCH");
}

function parseResources(rows: string[][]): ResourceOption[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Resource_ID");
  const nameIdx = headerIndex(headers, "Resource_Name");
  const typeIdx = headerIndex(headers, "Resource_Type");
  const enabledIdx = headerIndex(headers, "Enabled");
  const departmentIdx = headerIndex(headers, "Department");
  const durationIdx = headerIndex(headers, "Default_Duration_Min");
  return rows.slice(1).flatMap((row) => {
    const resourceId = at(row, idIdx);
    const resourceName = at(row, nameIdx);
    const resourceType = normalized(at(row, typeIdx));
    const department = normalized(at(row, departmentIdx));
    const durationMin = Number(at(row, durationIdx) || 0);
    if (!resourceId || !resourceName || department !== "physio" || !parseBoolean(at(row, enabledIdx))) return [];
    const traction = /traction/i.test(`${resourceId} ${resourceName}`);
    if (resourceType !== "machine" && !traction) return [];
    return [{
      resourceId,
      resourceName: traction ? "Traction" : resourceName,
      durationMin: traction ? TRACTION_EXPECTED_MIN : (Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 15),
    }];
  });
}

function expectedFromPlan(rows: string[][], patientId: string, resources: ResourceOption[]): ResourceOption[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const patientIdx = headerIndex(headers, "Patient_ID");
  const statusIdx = headerIndex(headers, "Status");
  const electroIdx = headerIndex(headers, "Electrotherapy_Plan");
  const manualIdx = headerIndex(headers, "Manual_Therapy_Plan");
  const exerciseIdx = headerIndex(headers, "Exercise_Plan");
  const active = rows.slice(1).filter(
    (row) => at(row, patientIdx) === patientId && normalized(at(row, statusIdx) || "Active") === "active"
  );
  const row = active[active.length - 1];
  if (!row) return [];
  const combined = `${at(row, electroIdx)} ${at(row, manualIdx)} ${at(row, exerciseIdx)}`;
  const aliases: Array<[RegExp, string]> = [
    [/facial\s*tens/i, "facial tens"],
    [/shockwave|sk5/i, "shockwave"],
    [/ultrasound|\bust\b/i, "ultrasound"],
    [/\bift\b/i, "ift"],
    [/\btens\b/i, "tens"],
    [/\bems\b/i, "ems"],
    [/\bswd\b|short\s*wave/i, "swd"],
    [/\bwax\b/i, "wax"],
    [/\birr\b|infra\s*red/i, "irr"],
  ];
  const selected: ResourceOption[] = [];
  for (const [pattern, label] of aliases) {
    if (!pattern.test(combined)) continue;
    const option = resources.find((item) => normalized(item.resourceName).includes(label));
    if (option && !selected.some((item) => item.resourceId === option.resourceId)) selected.push(option);
  }
  if (/\btraction\b/i.test(combined)) {
    const traction = resources.find((item) => /traction/i.test(`${item.resourceId} ${item.resourceName}`));
    selected.push(traction || {
      resourceId: "TRACTION-BED",
      resourceName: "Traction",
      durationMin: TRACTION_EXPECTED_MIN,
    });
  }
  return selected;
}

function parseAppointments(rows: string[][]): Appointment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idx("Appointment_ID"));
    if (!appointmentId) return [];
    let startMinute = 0;
    try {
      startMinute = timeMinutes(at(row, idx("Time")));
    } catch {
      return [];
    }
    const remarks = at(row, idx("Remarks"));
    const flow = flowFields(remarks);
    return [{
      appointmentId,
      date: at(row, idx("Date")),
      startMinute,
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      therapist: at(row, idx("Therapist")),
      status: at(row, idx("Status")) || "Scheduled",
      roomId: flow.roomId,
      gender: flow.gender,
      modalities: parseJsonArray(at(row, idx("Modalities_JSON"))),
      organizationId: at(row, idx("Organization_ID")),
      clinicId: at(row, idx("Clinic_ID")),
      resourceCode: at(row, idx("Assigned_Bed_ID")) || null,
    }];
  });
}

function appointmentActive(status: string): boolean {
  return ACTIVE.has(normalized(status));
}

function auditRow(
  context: AccessContext,
  appointmentId: string,
  patientId: string,
  organizationId: string,
  clinicId: string,
  after: string,
  now: ReturnType<typeof nowInTimezone>
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.display,
    context.staffId,
    "appointment.create_capacity",
    "Appointment",
    appointmentId,
    patientId,
    "",
    after,
    "Gender-capacity booking; machine demand advisory only",
    organizationId,
    clinicId,
    clinicId,
    `${clinicId}:${appointmentId}`,
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

function nowInTimezone(timeZone: string, ref = new Date()): { display: string; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const display = `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  return { display, iso: ref.toISOString() };
}

async function loadState() {
  const snapshot = await fetchSheetRanges("physio", [APPOINTMENT_SHEET, PLAN_SHEET, RESOURCE_SHEET]);
  const appointmentRows = snapshot[APPOINTMENT_SHEET] || [];
  const planRows = snapshot[PLAN_SHEET] || [];
  const resourceRows = snapshot[RESOURCE_SHEET] || [];
  if (!appointmentRows.length || !resourceRows.length) throw new Error("SCHEMA_MISMATCH");
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
    "Booking_Validation_Version",
  ]);
  return {
    appointmentRows,
    planRows,
    resourceRows,
    appointments: parseAppointments(appointmentRows),
    resources: parseResources(resourceRows),
  };
}

function validateInput(input: CapacityBookingInput): { date: string; startMinute: number; therapist: string } {
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  return { date, startMinute: timeMinutes(input.time), therapist: normalize(input.therapist) };
}

export async function validateCapacityBooking(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: CapacityBookingInput
): Promise<CapacityBookingValidation> {
  assertCanPerform(context, "appointment.create", "Physio");
  const patient = await getPatientForContext(context, input.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const { date, startMinute, therapist } = validateInput(input);
  const state = await loadState();
  const configuration = await readClinicConfiguration({ organizationId, clinicId });
  const gender = parseGender(patient.gender);
  const conflicts: CapacityConflict[] = [];
  const warnings: CapacityWarning[] = [];
  const configuredDuration = configuration.booking?.defaultDurationMin || 0;
  const hourEnd = startMinute + configuredDuration;
  const overlapping = state.appointments.filter((item) =>
    item.organizationId === organizationId && item.clinicId === clinicId &&
    item.date === date &&
    appointmentActive(item.status) &&
    overlaps(startMinute, hourEnd, item.startMinute, item.startMinute + configuredDuration)
  );
  const decision = resolveConfiguredBooking({ organizationId, clinicId }, { booking: configuration.booking || null, hours: configuration.operatingHours, resources: configuration.resources || [] }, { date, startMinute, patientId: patient.patientId, providerId: therapist, resourceCode: input.resourceCode, gender }, state.appointments.map((item) => ({ organizationId: item.organizationId, clinicId: item.clinicId, patientId: item.patientId, date: item.date, startMinute: item.startMinute, durationMin: configuredDuration, resourceCode: item.resourceCode, active: appointmentActive(item.status) })));
  if (!decision.ok) conflicts.push({ type: decision.reason === "duplicate" ? "duplicate" : decision.reason === "invalid" || decision.reason === "not_configured" ? "schema" : "capacity", message: decision.detail });
  const roomId = decision.ok ? decision.resource?.roomCode || "" : "";

  if (therapist) {
    const therapistLoad = overlapping.filter((item) => normalized(item.therapist) === normalized(therapist)).length;
    if (therapistLoad > 0) {
      warnings.push({
        type: "therapist_load",
        message: `${therapist} already has ${therapistLoad} patient${therapistLoad === 1 ? "" : "s"} planned in this hour. Booking is still allowed.`,
      });
    }
  }

  const expected = expectedFromPlan(state.planRows, patient.patientId, state.resources);
  const expectedDemand: ExpectedDemand[] = expected.map((resource) => {
    const current = overlapping.filter((item) => item.modalities.includes(resource.resourceId)).length;
    return {
      ...resource,
      expectedThisHour: current + 1,
    };
  });
  for (const demand of expectedDemand) {
    if (demand.expectedThisHour > 1) {
      warnings.push({
        type: "machine_demand",
        message: `${demand.resourceName} expected for ${demand.expectedThisHour} patients in this hour. This is advisory only; no machine time is reserved.`,
      });
    }
  }

  return {
    isValid: conflicts.length === 0,
    patientId: patient.patientId,
    patientName: patient.fullName,
    gender,
    roomId,
    sessionMinutes: decision.ok ? decision.durationMin : configuredDuration,
    toleranceMinutes: GENERAL_TOLERANCE_MIN,
    conflicts,
    warnings,
    expectedDemand,
    clinicTimezone: configuration.profile?.timezone || "UTC",
  };
}

function withPlanningTag(
  remarks: string,
  validation: CapacityBookingValidation
): string {
  const clean = normalize(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const tag = `[PTFLOW gender=${validation.gender};room=${validation.roomId};bed=;station=Treatment]`;
  return `${clean} ${tag}`.trim();
}

export async function createCapacityBooking(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: CapacityBookingInput
): Promise<{ appointmentId: string; validation: CapacityBookingValidation }> {
  assertCanPerform(context, "appointment.create", "Physio");
  const validation = await validateCapacityBooking(context, organizationId, clinicId, input);
  if (!validation.isValid) {
    const primary = validation.conflicts[0];
    const error = new Error(`APPOINTMENT_CONFLICT:${primary?.type || "capacity"}:${primary?.message || "Booking conflict"}`);
    (error as Error & { validation?: CapacityBookingValidation }).validation = validation;
    throw error;
  }
  const patient = await getPatientForContext(context, input.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const { date, startMinute, therapist } = validateInput(input);
  const state = await loadState();
  const headers = state.appointmentRows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const existing = new Set(state.appointmentRows.slice(1).map((row) => at(row, idIdx)));
  let appointmentId = "";
  for (let attempt = 0; attempt < 8 && !appointmentId; attempt += 1) {
    const candidate = `APW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existing.has(candidate)) appointmentId = candidate;
  }
  if (!appointmentId) throw new Error("ID_ALLOCATION_FAILED");
  const now = nowInTimezone(validation.clinicTimezone);
  const modalities = validation.expectedDemand.map((item) => item.resourceId);
  const appointmentRow = rowForHeaders(headers, {
    Appointment_ID: appointmentId,
    Date: date,
    Time: sheetTime(startMinute),
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Department: "Physio",
    Therapist: therapist,
    Status: "Scheduled",
    Remarks: withPlanningTag(input.remarks || "", validation),
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: clinicId,
    Record_ID: `${clinicId}:${appointmentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.iso,
    Received_By: context.staffId,
    Assigned_Bed_ID: input.resourceCode || "",
    Modalities_JSON: JSON.stringify(modalities),
    Expected_Duration_Min: validation.sessionMinutes,
    Timeline_ID: "",
    Booking_Validation_Version: VALIDATION_VERSION,
  });

  await appendRowsWithAudit(
    "physio",
    [{ sheet: APPOINTMENT_SHEET, row: appointmentRow }],
    auditRow(
      context,
      appointmentId,
      patient.patientId,
      organizationId,
      clinicId,
      JSON.stringify({
        appointmentId,
        date,
        time: sheetTime(startMinute),
        therapist,
        roomId: validation.roomId,
        gender: validation.gender,
        sessionMinutes: validation.sessionMinutes,
        toleranceMinutes: GENERAL_TOLERANCE_MIN,
        expectedDemand: validation.expectedDemand,
        machineReservationsCreated: false,
      }),
      now
    )
  );
  return { appointmentId, validation };
}
