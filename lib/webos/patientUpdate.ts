import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges, type Workbook } from "@/lib/data/googleSheets";
import { updatePatientProfileRow } from "@/lib/data/supabaseOperational";
import { isTenantNativeClinic } from "@/lib/domain/operations/store";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext } from "@/lib/webos/reception";
import {
  replaceEntityRowWithAudit,
  type SheetCellValue,
} from "@/lib/webos/sheetTransaction";

type ClinicDepartment = "Physio" | "Dental";

export interface PatientUpdateInput {
  fullName?: string;
  phone?: string;
  age?: string;
  gender?: string;
  address?: string;
  diagnosis?: string;
  therapist?: string;
  status?: string;
}

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

function quotePhone(value: unknown): string {
  const digits = normalizePhone(value);
  return digits ? `'${digits}` : "";
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(ref);
  return {
    timestamp: `${date} ${time}`,
    provenance: ref.toISOString(),
  };
}

function auditRow(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  department: ClinicDepartment,
  patientId: string,
  summary: Record<string, string>,
  now: ReturnType<typeof dhakaNow>
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    "patient.update",
    "Patient",
    patientId,
    patientId,
    "",
    JSON.stringify(summary),
    "Web patient profile correction",
    organizationId,
    clinicId,
    "AMTALI-01",
    `${clinicId}:${patientId}`,
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

export async function updatePatientProfile(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  patientId: string,
  input: PatientUpdateInput
): Promise<{ patientId: string }> {
  const patient = await getPatientForContext(context, patientId);
  if (!patient || patient.department === "All") throw new Error("PATIENT_NOT_FOUND");
  const department = patient.department as ClinicDepartment;
  assertCanPerform(context, "patient.update", department);

  if (await isTenantNativeClinic({ organizationId, clinicId })) {
    return updatePatientProfileRow({ organizationId, clinicId }, context.staffId, patient.patientId, {
      fullName: input.fullName === undefined ? undefined : normalize(input.fullName),
      phone: input.phone === undefined ? undefined : normalizePhone(input.phone),
      age: input.age === undefined ? undefined : normalize(input.age),
      gender: input.gender === undefined ? undefined : normalize(input.gender),
      address: input.address === undefined ? undefined : normalize(input.address),
      diagnosis: input.diagnosis === undefined ? undefined : normalize(input.diagnosis),
      therapist: input.therapist === undefined ? undefined : normalize(input.therapist),
      status: input.status === undefined ? undefined : normalize(input.status),
    });
  }

  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["02_Patients"]);
  const rows = snapshot["02_Patients"] || [];
  if (rows.length < 2) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Patient_ID");
  const phoneIdx = headerIndex(headers, "Phone");
  const statusIdx = headerIndex(headers, "Status");
  if (idIdx < 0) throw new Error("SCHEMA_MISMATCH");

  const dataIndex = rows.slice(1).findIndex(
    (row) => at(row, idIdx).toLowerCase() === patientId.trim().toLowerCase()
  );
  if (dataIndex < 0) throw new Error("PATIENT_NOT_FOUND");

  const nextPhone = input.phone === undefined ? undefined : normalizePhone(input.phone);
  if (nextPhone && phoneIdx >= 0) {
    const duplicate = rows.slice(1).some((row, index) => {
      if (index === dataIndex) return false;
      const rowStatus = statusIdx >= 0 ? at(row, statusIdx).toLowerCase() || "active" : "active";
      return rowStatus === "active" && normalizePhone(at(row, phoneIdx)) === nextPhone;
    });
    if (duplicate) throw new Error("DUPLICATE_PHONE");
  }

  const row = [...rows[dataIndex + 1]];
  while (row.length < headers.length) row.push("");
  const changed: Record<string, string> = {};
  const set = (header: string, value: string | undefined, track = true) => {
    if (value === undefined) return;
    const index = headerIndex(headers, header);
    if (index < 0) return;
    row[index] = value;
    if (track) changed[header] = value;
  };

  const fullName = input.fullName === undefined ? undefined : normalize(input.fullName);
  if (fullName !== undefined && fullName.length < 2) throw new Error("INVALID_PATIENT_NAME");

  set("Full_Name", fullName);
  set("Phone", input.phone === undefined ? undefined : quotePhone(input.phone));
  set("Age", input.age === undefined ? undefined : normalize(input.age));
  set("Gender", input.gender === undefined ? undefined : normalize(input.gender));
  set("Address", input.address === undefined ? undefined : normalize(input.address));
  set("Diagnosis", input.diagnosis === undefined ? undefined : normalize(input.diagnosis));
  set("Therapist", input.therapist === undefined ? undefined : normalize(input.therapist));
  set("Status", input.status === undefined ? undefined : normalize(input.status));

  if (Object.keys(changed).length === 0) throw new Error("NO_CHANGES");
  const now = dhakaNow();
  set("Last_Updated", now.timestamp, false);
  set("Provider_ID", context.staffId, false);
  set("Provenance_Timestamp", now.provenance, false);

  await replaceEntityRowWithAudit(
    workbook,
    "02_Patients",
    dataIndex + 2,
    row,
    auditRow(context, organizationId, clinicId, department, patient.patientId, changed, now)
  );
  return { patientId: patient.patientId };
}
