import "server-only";

import { randomUUID } from "node:crypto";
import { appendSheetValues, fetchSheetRanges } from "@/lib/data/googleSheets";
import type { PatientRecord } from "@/lib/patients";
import {
  assertCanPerform,
  canPerform,
  type AccessConditions,
  type AccessContext,
} from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import {
  getAppointmentsForContext,
  getPatientForContext,
  todayDhaka,
} from "@/lib/webos/reception";

type SheetValue = string | number | boolean;

export const DENTAL_STATUSES = ["Planned", "Ongoing", "Completed", "Follow-up"] as const;
export type DentalStatus = (typeof DENTAL_STATUSES)[number];

export interface DentalTreatmentRecord {
  treatmentId: string;
  date: string;
  patientId: string;
  patientName: string;
  procedure: string;
  toothArea: string;
  clinicalNote: string;
  status: string;
  clinician: string;
  remarks: string;
}

export interface DentalClinicalWorkspace {
  patient: Pick<PatientRecord, "patientId" | "fullName" | "department" | "diagnosis" | "therapist">;
  canWrite: boolean;
  treatments: DentalTreatmentRecord[];
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

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    date,
    timestamp: `${date} ${values.hour}:${values.minute}`,
    provenance: ref.toISOString(),
  };
}

function nameMatches(value: string, staffId: string, fullName: string): boolean {
  const needle = normalized(value);
  return Boolean(
    needle && (needle === normalized(staffId) || needle === normalized(fullName))
  );
}

async function dentalConditions(
  context: AccessContext,
  patient: PatientRecord
): Promise<AccessConditions> {
  if (context.roles.includes("Owner")) return {};
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) return {};

  const assignedToCurrentStaff = nameMatches(
    patient.therapist,
    identity.staffId,
    identity.fullName
  );
  if (assignedToCurrentStaff) return { assignedToCurrentStaff: true };

  const appointments = await getAppointmentsForContext(
    context,
    "dental",
    todayDhaka()
  );
  const currentDayCrossCover = appointments.some(
    (row) =>
      row.patientId === patient.patientId &&
      nameMatches(row.therapist, identity.staffId, identity.fullName)
  );
  return { assignedToCurrentStaff: false, currentDayCrossCover };
}

async function requireDentalPatient(
  context: AccessContext,
  patientId: string
): Promise<PatientRecord> {
  const patient = await getPatientForContext(context, patientId);
  if (!patient) throw new Error("PATIENT_NOT_FOUND");
  if (patient.department !== "Dental") throw new Error("CLINICAL_DENTAL_ONLY");
  assertCanPerform(context, "clinical.read", "Dental");
  return patient;
}

function statusFromRemarks(remarks: string): string {
  const match = /(?:^|\|)\s*Status:\s*([^|]+)/i.exec(remarks);
  return match?.[1]?.trim() || "";
}

function toothFromRemarks(remarks: string): string {
  const match = /(?:^|\|)\s*Tooth\/?Area:\s*([^|]+)/i.exec(remarks);
  return match?.[1]?.trim() || "";
}

function parseTreatments(rows: string[][], patientId: string): DentalTreatmentRecord[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  return rows
    .slice(1)
    .flatMap((row) => {
      if (at(row, idx("Patient_ID")) !== patientId) return [];
      const treatmentId = at(row, idx("Treatment_ID"));
      if (!treatmentId) return [];
      const remarks = at(row, idx("Remarks"));
      const department = at(row, idx("Department"));
      if (department && department.toLowerCase() !== "dental") return [];
      return [
        {
          treatmentId,
          date: at(row, idx("Date")),
          patientId,
          patientName: at(row, idx("Patient_Name")),
          procedure:
            at(row, idx("Treatment_Given", "Procedure", "Service")) || "Dental procedure",
          toothArea: at(row, idx("Tooth_Area", "Tooth")) || toothFromRemarks(remarks),
          clinicalNote:
            at(row, idx("Clinical_Note", "Diagnosis", "Note")) ||
            at(row, idx("Diagnosis")),
          status: at(row, idx("Treatment_Status", "Status")) || statusFromRemarks(remarks),
          clinician: at(row, idx("Therapist", "Dentist", "Created_By", "Provider_ID")),
          remarks,
        },
      ];
    })
    .reverse();
}

async function appendAudit(
  context: AccessContext,
  treatmentId: string,
  patientId: string,
  summary: string
): Promise<void> {
  const now = dhakaNow();
  try {
    await appendSheetValues("dental", "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      context.staffId,
      "clinical.dental_note.create",
      "Treatment",
      treatmentId,
      patientId,
      "",
      summary,
      "Telegram → Web Dental clinical parity",
      "RELIFE",
      "RELIFE-DENTAL",
      "AMTALI-01",
      `RELIFE-DENTAL:${treatmentId}`,
      "",
      context.staffId,
      "web_pwa",
      "human_entry",
      false,
      true,
      "relife-uda-v1",
      now.provenance,
      "Dental",
    ]]);
  } catch (error) {
    console.error("Dental clinical audit append failed", error);
  }
}

export async function getDentalClinicalWorkspace(
  context: AccessContext,
  patientId: string
): Promise<DentalClinicalWorkspace> {
  const patient = await requireDentalPatient(context, normalize(patientId));
  const snapshot = await fetchSheetRanges("dental", ["05_Treatments"]);
  const conditions = await dentalConditions(context, patient);
  return {
    patient: {
      patientId: patient.patientId,
      fullName: patient.fullName,
      department: patient.department,
      diagnosis: patient.diagnosis,
      therapist: patient.therapist,
    },
    canWrite: canPerform(context, "clinical.write", "Dental", conditions),
    treatments: parseTreatments(snapshot["05_Treatments"] || [], patient.patientId),
  };
}

export async function addDentalTreatmentNote(
  context: AccessContext,
  input: {
    patientId: string;
    procedure: string;
    toothArea?: string;
    clinicalNote: string;
    status: DentalStatus | string;
  }
): Promise<{ treatmentId: string }> {
  const patient = await requireDentalPatient(context, normalize(input.patientId));
  const conditions = await dentalConditions(context, patient);
  assertCanPerform(context, "clinical.write", "Dental", conditions);

  const procedure = normalize(input.procedure);
  const clinicalNote = normalize(input.clinicalNote);
  const toothArea = normalize(input.toothArea);
  const status = normalize(input.status);
  if (!procedure) throw new Error("DENTAL_PROCEDURE_REQUIRED");
  if (!clinicalNote) throw new Error("DENTAL_NOTE_REQUIRED");
  if (!DENTAL_STATUSES.includes(status as DentalStatus)) {
    throw new Error("DENTAL_STATUS_INVALID");
  }

  const snapshot = await fetchSheetRanges("dental", ["05_Treatments"]);
  const rows = snapshot["05_Treatments"] || [];
  if (rows.length === 0) throw new Error("CLINICAL_SCHEMA_MISMATCH");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Treatment_ID");
  const patientIdx = headerIndex(headers, "Patient_ID");
  if (idIdx < 0 || patientIdx < 0) throw new Error("CLINICAL_SCHEMA_MISMATCH");

  const treatmentId = `TRW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const now = dhakaNow();
  const remarks = [
    toothArea ? `Tooth/Area: ${toothArea}` : "",
    `Status: ${status}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const values: Record<string, SheetValue> = {
    Treatment_ID: treatmentId,
    Date: now.date,
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Department: "Dental",
    Diagnosis: clinicalNote,
    Treatment_Given: procedure,
    Procedure: procedure,
    Service: procedure,
    Tooth_Area: toothArea,
    Tooth: toothArea,
    Clinical_Note: clinicalNote,
    Treatment_Status: status,
    Status: status,
    Remarks: remarks,
    Therapist: context.staffId,
    Dentist: context.staffId,
    Created_By: context.staffId,
    Created_At: now.timestamp,
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-DENTAL",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-DENTAL:${treatmentId}`,
    Encounter_ID: `ENC-${treatmentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "dental_clinical_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
  };

  await appendSheetValues("dental", "'05_Treatments'!A:BN", [
    rowForHeaders(headers, values),
  ]);
  await appendAudit(
    context,
    treatmentId,
    patient.patientId,
    JSON.stringify({ procedure, toothArea, clinicalNote, status })
  );
  return { treatmentId };
}
