import "server-only";

import { randomUUID } from "node:crypto";
import {
  fetchSheetRanges,
  type Workbook,
} from "@/lib/data/googleSheets";
import { resolveStaffTenantContext } from "@/lib/domain/tenancy/staffTenantContext";
import { getPatients, type PatientRecord } from "@/lib/patients";
import type { Scope } from "@/lib/types";
import {
  assertCanPerform,
  canPerform,
  type AccessContext,
} from "@/lib/webos/access";
import { appendEntityWithAudit } from "@/lib/webos/sheetTransaction";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;
type ResolvedTenant = {
  organizationId: string;
  clinicId: string;
  organizationSlug?: string;
  clinicSlug?: string;
};

export interface PatientCreateInput {
  department: ClinicDepartment;
  fullName: string;
  fatherHusbandName?: string;
  phone?: string;
  alternativePhone?: string;
  age?: string;
  gender?: string;
  address?: string;
  diagnosis?: string;
  therapist?: string;
  referral?: string;
  remarks?: string;
}

export interface AppointmentCreateInput {
  patientId: string;
  date: string;
  /** HTML time input, HH:mm */
  time: string;
  therapist: string;
  remarks?: string;
}

export interface AppointmentRecord {
  appointmentId: string;
  date: string;
  time: string;
  patientId: string;
  patientName: string;
  department: ClinicDepartment;
  therapist: string;
  status: string;
  remarks: string;
  receivedBy: string;
  organizationId?: string;
  clinicId?: string;
}

export interface ClinicianOption {
  staffId: string;
  fullName: string;
  department: ClinicDepartment;
}

const ACTIVE_APPOINTMENT_STATUSES = new Set([
  "scheduled",
  "waiting",
  "in treatment",
  "arrived",
]);

const ROOMS = ["Room 1", "Room 2"] as const;
const BEDS: Record<(typeof ROOMS)[number], string[]> = {
  "Room 1": ["Bed 1", "Bed 2"],
  "Room 2": ["Bed 3", "Bed 4"],
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedHeader(value: string): string {
  return normalize(value).toLowerCase();
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map(normalizedHeader);
  for (const name of names) {
    const index = normalized.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function normalizePhone(value: unknown): string {
  let digits = normalize(value).replace(/^'/, "").replace(/\D/g, "");
  if (digits.startsWith("880")) digits = digits.slice(3);
  return digits;
}

function quotePhone(value: string): string {
  const digits = normalizePhone(value);
  return digits ? `'${digits}` : "";
}

function dhakaParts(ref = new Date()): {
  date: string;
  time: string;
  timestamp: string;
  provenance: string;
} {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const dateValues = Object.fromEntries(
    dateParts.map((part) => [part.type, part.value])
  );
  const date = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(ref);
  return {
    date,
    time,
    timestamp: `${date} ${time}`,
    provenance: ref.toISOString(),
  };
}

export function todayDhaka(): string {
  return dhakaParts().date;
}

function sheetTimeFromInput(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(normalize(value));
  if (!match) throw new Error("INVALID_TIME");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("INVALID_TIME");
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const normalizedValues = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => normalizedValues.get(normalizedHeader(header)) ?? "");
}

function ensureHeaders(headers: string[], required: string[]): void {
  const available = new Set(headers.map(normalizedHeader));
  if (required.some((header) => !available.has(header.toLowerCase()))) {
    throw new Error("SCHEMA_MISMATCH");
  }
}

function generateWebId(prefix: "PT" | "DT" | "AP", existing: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `${prefix}W${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("ID_ALLOCATION_FAILED");
}

function auditRow(
  context: AccessContext,
  action: string,
  entityType: string,
  entityId: string,
  patientId: string,
  department: ClinicDepartment,
  afterValue: string,
  now: ReturnType<typeof dhakaParts>,
  organizationId: string,
  clinicId: string
): SheetValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    action,
    entityType,
    entityId,
    patientId,
    "",
    afterValue,
    "Web OS W2 reception action",
    organizationId,
    clinicId,
    "AMTALI-01",
    `${clinicId}:${entityId}`,
    "",
    context.staffId,
    "web_pwa",
    "human_entry",
    false,
    true,
    "relife-uda-v1",
    now.provenance,
    department,
  ];
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return scope === "physio" ? department === "Physio" : department === "Dental";
}

function patientMatchesTenant(patient: PatientRecord, tenant: ResolvedTenant): boolean {
  if (
    patient.organizationId === tenant.organizationId &&
    patient.clinicId === tenant.clinicId
  ) {
    return true;
  }

  // Tenant #1 compatibility bridge while legacy Sheets still carry the old
  // RELIFE / RELIFE-PHYSIO / RELIFE-DENTAL identifiers. This is intentionally
  // bounded to the canonical Relife Amtali tenant; every other tenant remains
  // exact-match only.
  if (
    tenant.organizationSlug?.toLowerCase() !== "relife" ||
    tenant.clinicSlug?.toLowerCase() !== "amtali-main" ||
    patient.organizationId !== "RELIFE"
  ) {
    return false;
  }

  if (patient.department === "Physio") {
    return patient.clinicId === "RELIFE-PHYSIO";
  }
  if (patient.department === "Dental") {
    return patient.clinicId === "RELIFE-DENTAL";
  }
  return false;
}

async function tenantForContext(
  context: AccessContext,
  organizationId?: string,
  clinicId?: string
): Promise<ResolvedTenant> {
  const org = normalize(organizationId);
  const clinic = normalize(clinicId);
  if (org && clinic) return { organizationId: org, clinicId: clinic };
  const tenant = await resolveStaffTenantContext(context.staffId);
  if (!tenant?.organizationId || !tenant?.clinicId) throw new Error("ACCESS_DENIED");
  return {
    organizationId: tenant.organizationId,
    clinicId: tenant.clinicId,
    organizationSlug: tenant.organizationSlug,
    clinicSlug: tenant.clinicSlug,
  };
}

export async function getVisiblePatients(
  context: AccessContext,
  scope: Scope,
  organizationId?: string,
  clinicId?: string
): Promise<PatientRecord[]> {
  const tenant = await tenantForContext(context, organizationId, clinicId);
  const patients = await getPatients();
  return patients.filter(
    (patient) =>
      patient.department !== "All" &&
      patientMatchesTenant(patient, tenant) &&
      scopeAllows(scope, patient.department) &&
      canPerform(context, "patient.read", patient.department)
  );
}

export async function getPatientForContext(
  context: AccessContext,
  patientId: string,
  organizationId?: string,
  clinicId?: string
): Promise<PatientRecord | null> {
  const tenant = await tenantForContext(context, organizationId, clinicId);
  const patient = (await getPatients()).find(
    (row) =>
      row.patientId.toLowerCase() === normalize(patientId).toLowerCase() &&
      patientMatchesTenant(row, tenant)
  );
  if (!patient || patient.department === "All") return null;
  assertCanPerform(context, "patient.read", patient.department);
  return patient;
}

export async function allowedPatientCreateDepartments(
  context: AccessContext
): Promise<ClinicDepartment[]> {
  return (["Physio", "Dental"] as ClinicDepartment[]).filter((department) =>
    canPerform(context, "patient.create", department)
  );
}

export async function registerPatient(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: PatientCreateInput
): Promise<{ patientId: string }> {
  if (!normalize(organizationId) || !normalize(clinicId)) throw new Error("ACCESS_DENIED");
  const department = input.department;
  if (!(["Physio", "Dental"] as string[]).includes(department)) throw new Error("INVALID_DEPARTMENT");
  assertCanPerform(context, "patient.create", department);

  const fullName = normalize(input.fullName);
  if (fullName.length < 2) throw new Error("INVALID_PATIENT_NAME");

  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["02_Patients"]);
  const rows = snapshot["02_Patients"] || [];
  if (rows.length === 0) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  ensureHeaders(headers, ["Patient_ID", "Full_Name", "Department"]);

  const phoneIdx = headerIndex(headers, "Phone");
  const statusIdx = headerIndex(headers, "Status");
  const patientIdIdx = headerIndex(headers, "Patient_ID");
  const organizationIdx = headerIndex(headers, "Organization_ID");
  const clinicIdx = headerIndex(headers, "Clinic_ID");
  if (organizationIdx < 0 || clinicIdx < 0) throw new Error("SCHEMA_MISMATCH");
  const phone = normalizePhone(input.phone);
  if (phone) {
    const duplicate = rows.slice(1).find((row) => {
      const rowPhone = normalizePhone(at(row, phoneIdx));
      const rowStatus = at(row, statusIdx).toLowerCase() || "active";
      return (
        rowPhone === phone &&
        rowStatus === "active" &&
        at(row, organizationIdx) === organizationId &&
        at(row, clinicIdx) === clinicId
      );
    });
    if (duplicate) throw new Error(`DUPLICATE_PHONE:${at(duplicate, patientIdIdx)}`);
  }

  const existingIds = new Set(rows.slice(1).map((row) => at(row, patientIdIdx)));
  const patientId = generateWebId(department === "Dental" ? "DT" : "PT", existingIds);
  const now = dhakaParts();
  const values: Record<string, SheetValue> = {
    Patient_ID: patientId,
    Registration_Date: now.date,
    Registration_Time: now.time,
    Full_Name: fullName,
    Father_Husband_Name: normalize(input.fatherHusbandName),
    Phone: quotePhone(input.phone || ""),
    Alternative_Phone: quotePhone(input.alternativePhone || ""),
    Age: normalize(input.age),
    Gender: normalize(input.gender),
    Address: normalize(input.address),
    Department: department,
    Diagnosis: normalize(input.diagnosis),
    Therapist: normalize(input.therapist),
    Payment_Status: "Due",
    Total_Bill: 0,
    Paid: 0,
    Due: 0,
    Referral: normalize(input.referral),
    Remarks: normalize(input.remarks),
    Status: "Active",
    Created_By: context.staffId,
    Created_At: now.timestamp,
    Last_Updated: now.timestamp,
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${patientId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
  };

  await appendEntityWithAudit(
    workbook,
    "02_Patients",
    rowForHeaders(headers, values),
    auditRow(context, "patient.create", "Patient", patientId, patientId, department,
      JSON.stringify({ patientId, fullName, department }), now, organizationId, clinicId)
  );
  return { patientId };
}

function parseDepartment(value: string, fallback: ClinicDepartment): ClinicDepartment {
  return normalize(value).toLowerCase() === "dental" ? "Dental" : fallback;
}

function parseAppointments(
  rows: string[][],
  fallback: ClinicDepartment,
  organizationId: string,
  clinicId: string
): AppointmentRecord[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const dateIdx = headerIndex(headers, "Date");
  const timeIdx = headerIndex(headers, "Time");
  const patientIdIdx = headerIndex(headers, "Patient_ID");
  const patientNameIdx = headerIndex(headers, "Patient_Name");
  const departmentIdx = headerIndex(headers, "Department");
  const therapistIdx = headerIndex(headers, "Therapist");
  const statusIdx = headerIndex(headers, "Status");
  const remarksIdx = headerIndex(headers, "Remarks");
  const receivedByIdx = headerIndex(headers, "Received_By");
  const orgIdIdx = headerIndex(headers, "Organization_ID");
  const clinicIdIdx = headerIndex(headers, "Clinic_ID");
  if (orgIdIdx < 0 || clinicIdIdx < 0) return [];

  return rows.slice(1).flatMap((row) => {
    const appointmentId = at(row, idIdx);
    const recordOrgId = at(row, orgIdIdx);
    const recordClinicId = at(row, clinicIdIdx);
    if (!appointmentId || recordOrgId !== organizationId || recordClinicId !== clinicId) return [];
    return [{
      appointmentId,
      date: at(row, dateIdx),
      time: at(row, timeIdx),
      patientId: at(row, patientIdIdx),
      patientName: at(row, patientNameIdx),
      department: parseDepartment(at(row, departmentIdx), fallback),
      therapist: at(row, therapistIdx),
      status: at(row, statusIdx) || "Scheduled",
      remarks: at(row, remarksIdx),
      receivedBy: at(row, receivedByIdx),
      organizationId: recordOrgId,
      clinicId: recordClinicId,
    }];
  });
}

async function loadAppointments(
  organizationId: string,
  clinicId: string
): Promise<AppointmentRecord[]> {
  const [physio, dental] = await Promise.all([
    fetchSheetRanges("physio", ["04_Appointments"]),
    fetchSheetRanges("dental", ["04_Appointments"]),
  ]);
  return [
    ...parseAppointments(physio["04_Appointments"] || [], "Physio", organizationId, clinicId),
    ...parseAppointments(dental["04_Appointments"] || [], "Dental", organizationId, clinicId),
  ];
}

export async function getAppointmentsForContext(
  context: AccessContext,
  scope: Scope,
  date?: string,
  organizationId?: string,
  clinicId?: string
): Promise<AppointmentRecord[]> {
  const tenant = await tenantForContext(context, organizationId, clinicId);
  const rows = await loadAppointments(tenant.organizationId, tenant.clinicId);
  return rows
    .filter((row) =>
      scopeAllows(scope, row.department) &&
      (!date || row.date === date) &&
      canPerform(context, "appointment.read", row.department)
    )
    .sort((a, b) => {
      const dateOrder = a.date.localeCompare(b.date);
      return dateOrder !== 0 ? dateOrder : appointmentMinutes(a.time) - appointmentMinutes(b.time);
    });
}

export async function getPatientAppointmentsForContext(
  context: AccessContext,
  patient: PatientRecord,
  organizationId?: string,
  clinicId?: string
): Promise<AppointmentRecord[]> {
  const tenant = await tenantForContext(context, organizationId, clinicId);
  if (!patientMatchesTenant(patient, tenant)) return [];
  assertCanPerform(context, "appointment.read", patient.department);
  const rows = await loadAppointments(tenant.organizationId, tenant.clinicId);
  return rows
    .filter((row) =>
      row.patientId === patient.patientId &&
      row.department === patient.department &&
      canPerform(context, "appointment.read", row.department)
    )
    .sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date);
      return dateOrder !== 0 ? dateOrder : appointmentMinutes(b.time) - appointmentMinutes(a.time);
    });
}

export async function getClinicianOptions(context: AccessContext): Promise<ClinicianOption[]> {
  const directory = await getWebStaffDirectory();
  return directory.flatMap((staff) => {
    if (staff.status !== "Active") return [];
    const department: ClinicDepartment | null = staff.roles.includes("Dentist")
      ? "Dental"
      : staff.roles.includes("Therapist") ? "Physio" : null;
    if (!department || !canPerform(context, "appointment.create", department)) return [];
    return [{ staffId: staff.staffId, fullName: staff.fullName, department }];
  });
}

function normalizeGender(value: unknown): "Male" | "Female" | "" {
  const text = normalize(value).toLowerCase();
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

interface FlowFields { Gender: "Male" | "Female" | ""; Room: string; Bed: string; Station: string; }

function flowFields(remarks: string): FlowFields {
  const fields: FlowFields = { Gender: "", Room: "", Bed: "", Station: "" };
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return fields;
  const parsed = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const [key, ...value] = part.split("=");
    if (key && value.length) parsed.set(key.trim().toLowerCase(), value.join("=").trim());
  }
  fields.Gender = normalizeGender(parsed.get("gender"));
  fields.Room = parsed.get("room") || "";
  fields.Bed = parsed.get("bed") || "";
  fields.Station = parsed.get("station") || "";
  return fields;
}

function withFlowTag(remarks: string, assignment: FlowFields): string {
  const clean = normalize(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const tag = `[PTFLOW gender=${assignment.Gender};room=${assignment.Room};bed=${assignment.Bed};station=${assignment.Station}]`;
  return `${clean} ${tag}`.trim();
}

function allocatePhysioResource(
  appointments: AppointmentRecord[], date: string, time: string, genderValue: string, needsTraction: boolean
): FlowFields {
  const gender = normalizeGender(genderValue);
  if (!gender) return { Gender: "", Room: "Waiting", Bed: "", Station: "Waiting" };
  const slot = appointments.filter((row) =>
    row.department === "Physio" && row.date === date && row.time === time &&
    ACTIVE_APPOINTMENT_STATUSES.has(row.status.toLowerCase())
  );
  const occupied = slot.map((row) => flowFields(row.remarks));
  if (needsTraction) {
    if (occupied.some((item) => item.Station === "Traction")) {
      throw new Error("APPOINTMENT_CAPACITY:Traction Bed already booked");
    }
    return { Gender: gender, Room: "Traction Room", Bed: "Traction Bed", Station: "Traction" };
  }
  const roomGenders = new Map<string, Set<string>>(ROOMS.map((room) => [room, new Set<string>()]));
  const occupiedBeds = new Set<string>();
  for (const item of occupied) {
    if (roomGenders.has(item.Room) && item.Gender) roomGenders.get(item.Room)?.add(item.Gender);
    if (item.Bed) occupiedBeds.add(item.Bed);
  }
  const preferred = [
    ...ROOMS.filter((room) => {
      const genders = roomGenders.get(room) || new Set<string>();
      return genders.size === 1 && genders.has(gender);
    }),
    ...ROOMS.filter((room) => (roomGenders.get(room)?.size || 0) === 0),
  ];
  for (const room of preferred) {
    for (const bed of BEDS[room]) {
      if (!occupiedBeds.has(bed)) return { Gender: gender, Room: room, Bed: bed, Station: "Treatment" };
    }
  }
  throw new Error("APPOINTMENT_CAPACITY:No gender-compatible treatment bed available");
}

function activePlanNeedsTraction(rows: string[][], patientId: string): boolean {
  if (rows.length < 2) return false;
  const headers = rows[0];
  const patientIdx = headerIndex(headers, "Patient_ID");
  const statusIdx = headerIndex(headers, "Status");
  const exerciseIdx = headerIndex(headers, "Exercise_Plan");
  const electroIdx = headerIndex(headers, "Electrotherapy_Plan");
  const manualIdx = headerIndex(headers, "Manual_Therapy_Plan");
  return rows.slice(1).some((row) => {
    if (at(row, patientIdx) !== patientId) return false;
    if ((at(row, statusIdx) || "Active").toLowerCase() !== "active") return false;
    return [exerciseIdx, electroIdx, manualIdx]
      .map((index) => at(row, index).toLowerCase())
      .some((text) => text.includes("traction"));
  });
}

export async function createAppointment(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: AppointmentCreateInput
): Promise<{ appointmentId: string }> {
  if (!normalize(organizationId) || !normalize(clinicId)) throw new Error("ACCESS_DENIED");
  const patient = await getPatientForContext(context, input.patientId, organizationId, clinicId);
  if (!patient || patient.department === "All") throw new Error("PATIENT_NOT_FOUND");
  const department = patient.department;
  assertCanPerform(context, "appointment.create", department);
  const date = normalize(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const time = sheetTimeFromInput(input.time);
  const therapist = normalize(input.therapist);
  if (!therapist) throw new Error("INVALID_THERAPIST");
  const workbook = workbookForDepartment(department);
  const ranges = department === "Physio" ? ["04_Appointments", "12_Treatment_Plans"] : ["04_Appointments"];
  const snapshot = await fetchSheetRanges(workbook, ranges);
  const rawAppointments = snapshot["04_Appointments"] || [];
  if (rawAppointments.length === 0) throw new Error("SCHEMA_MISMATCH");
  const headers = rawAppointments[0];
  ensureHeaders(headers, ["Appointment_ID", "Date", "Time", "Patient_ID", "Department", "Status"]);
  const appointments = parseAppointments(rawAppointments, department, organizationId, clinicId);
  const duplicate = appointments.some((row) =>
    row.patientId === patient.patientId && row.date === date && row.time === time &&
    ACTIVE_APPOINTMENT_STATUSES.has(row.status.toLowerCase())
  );
  if (duplicate) throw new Error("APPOINTMENT_DUPLICATE");
  let remarks = normalize(input.remarks);
  if (department === "Physio") {
    const needsTraction = activePlanNeedsTraction(snapshot["12_Treatment_Plans"] || [], patient.patientId);
    remarks = withFlowTag(remarks, allocatePhysioResource(appointments, date, time, patient.gender, needsTraction));
  }
  const idIdx = headerIndex(headers, "Appointment_ID");
  const existingIds = new Set(rawAppointments.slice(1).map((row) => at(row, idIdx)));
  const appointmentId = generateWebId("AP", existingIds);
  const now = dhakaParts();
  const values: Record<string, SheetValue> = {
    Appointment_ID: appointmentId, Date: date, Time: time, Patient_ID: patient.patientId,
    Patient_Name: patient.fullName, Department: department, Therapist: therapist, Status: "Scheduled",
    Remarks: remarks, Organization_ID: organizationId, Clinic_ID: clinicId, Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${appointmentId}`, Provider_ID: context.staffId, Source_System: "web_pwa",
    Source_Type: "human_entry", AI_Generated: false, Human_Verified: true,
    Schema_Version: "relife-uda-v1", Provenance_Timestamp: now.provenance, Received_By: context.staffId,
  };
  await appendEntityWithAudit(
    workbook, "04_Appointments", rowForHeaders(headers, values),
    auditRow(context, "appointment.create", "Appointment", appointmentId, patient.patientId, department,
      JSON.stringify({ appointmentId, patientId: patient.patientId, date, time, therapist }),
      now, organizationId, clinicId)
  );
  return { appointmentId };
}

export function appointmentMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(normalize(value));
  if (!match) return 24 * 60;
  let hour = Number(match[1]) % 12;
  const minute = Number(match[2]);
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + minute;
}
