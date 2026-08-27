import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges, type Workbook } from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { appendEntityWithAudit } from "@/lib/webos/sheetTransaction";

type ClinicDepartment = "Physio" | "Dental";
type SheetValue = string | number | boolean;

// New registrations use department-scoped serial IDs; legacy IDs remain unchanged.
export interface SerialPatientCreateInput {
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
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
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

export function nextSerialPatientId(
  department: ClinicDepartment,
  rows: string[][],
  patientIdIndex: number
): string {
  const prefix = department === "Dental" ? "DT" : "PT";
  const serialPattern = new RegExp(`^${prefix}(\\d+)$`, "i");
  let highest = 0;

  for (const row of rows.slice(1)) {
    const match = serialPattern.exec(at(row, patientIdIndex));
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) highest = Math.max(highest, value);
  }

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

function auditRow(
  context: AccessContext,
  patientId: string,
  fullName: string,
  department: ClinicDepartment,
  now: ReturnType<typeof dhakaParts>,
  organizationId: string,
  clinicId: string
): SheetValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    "patient.create",
    "Patient",
    patientId,
    patientId,
    "",
    JSON.stringify({ patientId, fullName, department }),
    "Web OS W2 reception action",
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

export async function registerPatientSerial(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: SerialPatientCreateInput
): Promise<{ patientId: string }> {
  const department = input.department;
  if (!(["Physio", "Dental"] as string[]).includes(department)) {
    throw new Error("INVALID_DEPARTMENT");
  }
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
  const phone = normalizePhone(input.phone);
  if (phone) {
    const duplicate = rows.slice(1).find((row) => {
      const rowPhone = normalizePhone(at(row, phoneIdx));
      const rowStatus = at(row, statusIdx).toLowerCase() || "active";
      return rowPhone === phone && rowStatus === "active";
    });
    if (duplicate) {
      const existingId = at(duplicate, patientIdIdx);
      throw new Error(`DUPLICATE_PHONE:${existingId}`);
    }
  }

  const patientId = nextSerialPatientId(department, rows, patientIdIdx);
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
    auditRow(context, patientId, fullName, department, now, organizationId, clinicId)
  );

  return { patientId };
}
