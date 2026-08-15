import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  updateSheetValues,
  type Workbook,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext } from "@/lib/webos/reception";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;

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

function columnLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function clinicId(department: ClinicDepartment): string {
  return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
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
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
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

async function appendAudit(
  workbook: Workbook,
  context: AccessContext,
  department: ClinicDepartment,
  patientId: string,
  summary: Record<string, string>
): Promise<void> {
  const now = dhakaNow();
  try {
    const clinic = clinicId(department);
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [[
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
      "RELIFE",
      clinic,
      "AMTALI-01",
      `${clinic}:${patientId}`,
      "",
      context.staffId,
      "web_pwa",
      "human_entry",
      false,
      true,
      "relife-uda-v1",
      now.provenance,
      department,
    ]]);
  } catch (error) {
    console.error("Patient update audit append failed", error);
  }
}

export async function updatePatientProfile(
  context: AccessContext,
  patientId: string,
  input: PatientUpdateInput
): Promise<{ patientId: string }> {
  const patient = await getPatientForContext(context, patientId);
  if (!patient || patient.department === "All") throw new Error("PATIENT_NOT_FOUND");
  const department = patient.department as ClinicDepartment;
  assertCanPerform(context, "patient.update", department);

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
  const set = (header: string, value: string | undefined) => {
    if (value === undefined) return;
    const index = headerIndex(headers, header);
    if (index < 0) return;
    row[index] = value;
    changed[header] = value;
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
  set("Last_Updated", now.timestamp);
  set("Provider_ID", context.staffId);
  set("Provenance_Timestamp", now.provenance);

  const rowNumber = dataIndex + 2;
  const endColumn = columnLetter(Math.max(0, headers.length - 1));
  await updateSheetValues(
    workbook,
    `'02_Patients'!A${rowNumber}:${endColumn}${rowNumber}`,
    [row as SheetValue[]]
  );
  await appendAudit(workbook, context, department, patient.patientId, changed);
  return { patientId: patient.patientId };
}
