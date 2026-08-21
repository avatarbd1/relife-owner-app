import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { applyDentalTreatmentCharge } from "@/lib/domain/clinical/dentalBilling";
import { invalidatePatientsCache, type PatientRecord } from "@/lib/patients";
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
import { appendEntityWithCellUpdatesAndAudit } from "@/lib/webos/sheetTransaction";

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
  charge: number;
  status: string;
  clinician: string;
  remarks: string;
}

export interface DentalClinicalWorkspace {
  patient: Pick<PatientRecord, "patientId" | "fullName" | "department" | "diagnosis" | "therapist" | "due">;
  canWrite: boolean;
  treatments: DentalTreatmentRecord[];
}

export interface DentalTreatmentWriteResult {
  treatmentId: string;
  charge: number;
  due: number;
  totalBill: number;
  duplicate: boolean;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function money(value: unknown): number {
  const parsed = Number.parseFloat(normalize(value).replace(/৳|,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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

function validateRequestId(value: unknown): string {
  const requestId = normalize(value);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error("DENTAL_REQUEST_ID_INVALID");
  }
  return requestId;
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

function chargeFromRemarks(remarks: string): number {
  const match = /(?:^|\|)\s*Charge:\s*৳?\s*([\d,.]+)/i.exec(remarks);
  return match ? money(match[1]) : 0;
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
          charge:
            money(at(row, idx("Charge", "Amount", "Fee"))) || chargeFromRemarks(remarks),
          status: at(row, idx("Treatment_Status", "Status")) || statusFromRemarks(remarks),
          clinician: at(row, idx("Therapist", "Dentist", "Created_By", "Provider_ID")),
          remarks,
        },
      ];
    })
    .reverse();
}

function auditRow(
  context: AccessContext,
  treatmentId: string,
  patientId: string,
  beforeValue: string,
  afterValue: string,
  now: ReturnType<typeof dhakaNow>
): SheetValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    "clinical.dental_treatment.create",
    "Treatment",
    treatmentId,
    patientId,
    beforeValue,
    afterValue,
    "Dental clinical + billing atomic write",
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
  ];
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
      due: patient.due,
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
    charge: number;
    status: DentalStatus | string;
    requestId: string;
  }
): Promise<DentalTreatmentWriteResult> {
  const patient = await requireDentalPatient(context, normalize(input.patientId));
  const conditions = await dentalConditions(context, patient);
  assertCanPerform(context, "clinical.write", "Dental", conditions);

  const procedure = normalize(input.procedure);
  const clinicalNote = normalize(input.clinicalNote);
  const toothArea = normalize(input.toothArea);
  const status = normalize(input.status);
  const charge = Number(input.charge);
  const requestId = validateRequestId(input.requestId);
  if (!procedure) throw new Error("DENTAL_PROCEDURE_REQUIRED");
  if (!clinicalNote) throw new Error("DENTAL_NOTE_REQUIRED");
  if (!Number.isFinite(charge) || !Number.isInteger(charge) || charge < 0) {
    throw new Error("DENTAL_CHARGE_INVALID");
  }
  if (!DENTAL_STATUSES.includes(status as DentalStatus)) {
    throw new Error("DENTAL_STATUS_INVALID");
  }

  const snapshot = await fetchSheetRanges("dental", ["05_Treatments", "02_Patients"]);
  const rows = snapshot["05_Treatments"] || [];
  const patientRows = snapshot["02_Patients"] || [];
  if (rows.length === 0 || patientRows.length < 2) throw new Error("CLINICAL_SCHEMA_MISMATCH");

  const headers = rows[0];
  const idIdx = headerIndex(headers, "Treatment_ID");
  const treatmentPatientIdx = headerIndex(headers, "Patient_ID");
  const remarksIdx = headerIndex(headers, "Remarks");
  if (idIdx < 0 || treatmentPatientIdx < 0 || remarksIdx < 0) {
    throw new Error("CLINICAL_SCHEMA_MISMATCH");
  }

  const patientHeaders = patientRows[0];
  const patientIdIdx = headerIndex(patientHeaders, "Patient_ID");
  const totalBillIdx = headerIndex(patientHeaders, "Total_Bill");
  const dueIdx = headerIndex(patientHeaders, "Due");
  const paymentStatusIdx = headerIndex(patientHeaders, "Payment_Status");
  const updatedIdx = headerIndex(patientHeaders, "Last_Updated");
  const advanceIdx = headerIndex(patientHeaders, "Advance_Balance");
  if (
    patientIdIdx < 0 ||
    totalBillIdx < 0 ||
    dueIdx < 0 ||
    paymentStatusIdx < 0 ||
    updatedIdx < 0
  ) {
    throw new Error("CLINICAL_SCHEMA_MISMATCH");
  }

  const patientDataIndex = patientRows.slice(1).findIndex(
    (row) => at(row, patientIdIdx).toUpperCase() === patient.patientId.toUpperCase()
  );
  if (patientDataIndex < 0) throw new Error("PATIENT_NOT_FOUND");
  const patientRow = patientRows[patientDataIndex + 1];
  const patientRowNumber = patientDataIndex + 2;
  const currentTotalBill = Math.max(0, money(at(patientRow, totalBillIdx)));
  const currentDue = Math.max(0, money(at(patientRow, dueIdx)));
  const currentAdvance = Math.max(0, money(at(patientRow, advanceIdx)));

  const marker = `DENTALREQ:${requestId}`;
  const existingRequest = rows.slice(1).find(
    (row) =>
      at(row, treatmentPatientIdx).toUpperCase() === patient.patientId.toUpperCase() &&
      at(row, remarksIdx).includes(marker)
  );
  if (existingRequest) {
    const existingRemarks = at(existingRequest, remarksIdx);
    const existingCharge =
      money(at(existingRequest, headerIndex(headers, "Charge", "Amount", "Fee"))) ||
      chargeFromRemarks(existingRemarks);
    return {
      treatmentId: at(existingRequest, idIdx),
      charge: existingCharge,
      due: currentDue,
      totalBill: currentTotalBill,
      duplicate: true,
    };
  }

  const billing = applyDentalTreatmentCharge(
    {
      totalBill: currentTotalBill,
      due: currentDue,
      advanceBalance: currentAdvance,
    },
    charge
  );

  const treatmentId = `TRW${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const now = dhakaNow();
  const remarks = [
    toothArea ? `Tooth/Area: ${toothArea}` : "",
    `Charge: ৳${charge}`,
    `Status: ${status}`,
    marker,
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
    Charge: charge,
    Amount: charge,
    Fee: charge,
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

  const updates = [
    {
      sheet: "02_Patients",
      rowNumber: patientRowNumber,
      columnNumber: totalBillIdx + 1,
      value: billing.newTotalBill,
    },
    {
      sheet: "02_Patients",
      rowNumber: patientRowNumber,
      columnNumber: dueIdx + 1,
      value: billing.newDue,
    },
    {
      sheet: "02_Patients",
      rowNumber: patientRowNumber,
      columnNumber: paymentStatusIdx + 1,
      value: billing.paymentStatus,
    },
    {
      sheet: "02_Patients",
      rowNumber: patientRowNumber,
      columnNumber: updatedIdx + 1,
      value: now.timestamp,
    },
  ];
  if (advanceIdx >= 0) {
    updates.push({
      sheet: "02_Patients",
      rowNumber: patientRowNumber,
      columnNumber: advanceIdx + 1,
      value: billing.newAdvanceBalance,
    });
  }

  const beforeValue = JSON.stringify({
    totalBill: currentTotalBill,
    due: currentDue,
    advanceBalance: currentAdvance,
  });
  const afterValue = JSON.stringify({
    procedure,
    toothArea,
    clinicalNote,
    charge,
    status,
    totalBill: billing.newTotalBill,
    due: billing.newDue,
    advanceBalance: billing.newAdvanceBalance,
    advanceApplied: billing.advanceApplied,
    requestId,
  });

  await appendEntityWithCellUpdatesAndAudit(
    "dental",
    "05_Treatments",
    rowForHeaders(headers, values),
    updates,
    auditRow(context, treatmentId, patient.patientId, beforeValue, afterValue, now)
  );
  invalidatePatientsCache();

  return {
    treatmentId,
    charge,
    due: billing.newDue,
    totalBill: billing.newTotalBill,
    duplicate: false,
  };
}
