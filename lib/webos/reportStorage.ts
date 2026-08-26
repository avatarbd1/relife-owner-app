import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  type Workbook,
} from "@/lib/data/googleSheets";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext } from "@/lib/webos/reception";

type SheetValue = string | number | boolean;
type ClinicDepartment = "Physio" | "Dental";

const REPORT_BUCKET = "relife-patient-reports";
const STORAGE_LINK_PREFIX = `supabase://${REPORT_BUCKET}/`;
const DEFAULT_EDGE_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-report-storage";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => normalized(header) === name.toLowerCase());
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(
  headers: string[],
  values: Record<string, SheetValue>
): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
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
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${value.year}-${value.month}-${value.day}`;
  return {
    date,
    timestamp: `${date} ${value.hour}:${value.minute}`,
    provenance: ref.toISOString(),
  };
}

function edgeConfig(): { url: string; secret: string } {
  const secret = process.env.REPORT_STORAGE_EDGE_SECRET?.trim();
  if (!secret) throw new Error("REPORT_STORAGE_NOT_CONFIGURED");
  return {
    url: (process.env.REPORT_STORAGE_EDGE_URL?.trim() || DEFAULT_EDGE_URL).replace(/\/+$/, ""),
    secret,
  };
}

export function reportStorageReady(): boolean {
  return Boolean(process.env.REPORT_STORAGE_EDGE_SECRET?.trim());
}

function safeSegment(value: string, fallback: string): string {
  const sanitized = normalize(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, 160);
  return sanitized || fallback;
}

function objectPath(input: {
  clinic: string;
  patientId: string;
  reportId: string;
  fileName: string;
}): string {
  if (!normalize(input.clinic)) throw new Error("ACCESS_DENIED");
  return [
    safeSegment(input.clinic, "clinic"),
    safeSegment(input.patientId, "patient"),
    safeSegment(input.reportId, "report"),
    safeSegment(input.fileName, "report.bin"),
  ].join("/");
}

function storageLink(path: string): string {
  return `${STORAGE_LINK_PREFIX}${path}`;
}

export function reportStoragePathFromLink(value: string): string {
  const link = normalize(value);
  if (!link.startsWith(STORAGE_LINK_PREFIX)) return "";
  const path = link.slice(STORAGE_LINK_PREFIX.length);
  if (
    !path ||
    path.length > 500 ||
    path.includes("\\") ||
    path.includes("..") ||
    path.split("/").some((part) => !/^[A-Za-z0-9._-]{1,180}$/.test(part))
  ) {
    return "";
  }
  return path;
}

async function uploadObject(
  path: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array
): Promise<void> {
  const config = edgeConfig();
  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  const form = new FormData();
  form.set("path", path);
  form.set("file", new Blob([fileBuffer], { type: mimeType }), fileName);
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "x-relife-report-key": config.secret },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(40_000),
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `REPORT_STORAGE_UPLOAD_HTTP_${response.status}`);
  }
}

async function deleteObject(path: string): Promise<void> {
  const config = edgeConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relife-report-key": config.secret,
    },
    body: JSON.stringify({ action: "delete", path }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`REPORT_STORAGE_DELETE_HTTP_${response.status}`);
}

export async function downloadPrivatePatientReport(
  link: string
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const path = reportStoragePathFromLink(link);
  if (!path) throw new Error("REPORT_STORAGE_LINK_INVALID");
  const config = edgeConfig();
  const response = await fetch(
    `${config.url}?path=${encodeURIComponent(path)}`,
    {
      headers: { "x-relife-report-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    }
  );
  if (!response.ok) {
    throw new Error(`REPORT_STORAGE_DOWNLOAD_HTTP_${response.status}`);
  }
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function uploadPatientReportToPrivateStorage(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: {
    patientId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }
): Promise<{ reportId: string; driveLink: string }> {
  const patientId = normalize(input.patientId);
  const fileName = normalize(input.fileName).replace(/[\\/]/g, "_").slice(0, 180);
  const mimeType = normalize(input.mimeType).toLowerCase() || "application/octet-stream";
  if (!organizationId.trim() || !clinicId.trim()) throw new Error("ACCESS_DENIED");
  if (!patientId || !fileName) throw new Error("REPORT_FIELDS_REQUIRED");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_BYTES) {
    throw new Error("REPORT_FILE_SIZE_INVALID");
  }
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("REPORT_FILE_TYPE_INVALID");

  const patient = await getPatientForContext(context, patientId);
  if (!patient || patient.department === "All") throw new Error("PATIENT_NOT_FOUND");
  const department = patient.department as ClinicDepartment;
  if (!canPerform(context, "patient.report.upload", department)) {
    throw new Error("ACCESS_DENIED");
  }

  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["14_Reports"]);
  const rows = snapshot["14_Reports"] || [];
  if (rows.length < 1) throw new Error("REPORT_SCHEMA_MISMATCH");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Report_ID");
  if (idIdx < 0) throw new Error("REPORT_SCHEMA_MISMATCH");
  const existingIds = new Set(rows.slice(1).map((row) => at(row, idIdx)).filter(Boolean));
  let reportId = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `RPW${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`;
    if (!existingIds.has(candidate)) {
      reportId = candidate;
      break;
    }
  }
  if (!reportId) throw new Error("REPORT_ID_ALLOCATION_FAILED");

  const path = objectPath({
    clinic: clinicId,
    patientId: patient.patientId,
    reportId,
    fileName,
  });
  await uploadObject(path, fileName, mimeType, input.bytes);

  const now = dhakaNow();
  const privateLink = storageLink(path);
  try {
    await appendSheetValues(workbook, "'14_Reports'!A:Z", [
      rowForHeaders(headers, {
        Report_ID: reportId,
        Patient_ID: patient.patientId,
        Patient_Name: patient.fullName,
        File_Telegram_ID: "",
        File_Name: fileName,
        File_Type: mimeType,
        Upload_Date: now.date,
        Uploaded_By: context.staffId,
        File_Drive_Link: privateLink,
        Organization_ID: organizationId,
        Clinic_ID: clinicId,
        Branch_ID: "AMTALI-01",
        Record_ID: `${clinicId}:${reportId}`,
        Encounter_ID: "",
        Provider_ID: context.staffId,
        Source_System: "web_pwa",
        Source_Type: "human_upload",
        AI_Generated: false,
        Human_Verified: true,
        Schema_Version: "relife-uda-v1",
        Provenance_Timestamp: now.provenance,
        Department: department,
      }),
    ]);
  } catch (error) {
    try {
      await deleteObject(path);
    } catch (rollbackError) {
      console.error("Report storage rollback failed", path, rollbackError);
    }
    throw error;
  }

  try {
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      context.staffId,
      "patient.report.upload",
      "PatientReport",
      reportId,
      patient.patientId,
      "",
      JSON.stringify({ storage: REPORT_BUCKET, objectPath: path, fileName, mimeType }),
      "Web PWA patient report upload",
      organizationId,
      clinicId,
      "AMTALI-01",
      `${clinicId}:${reportId}`,
      "",
      context.staffId,
      "web_pwa",
      "human_upload",
      false,
      true,
      "relife-uda-v1",
      now.provenance,
      department,
    ]]);
  } catch (error) {
    console.error("Report audit append failed", error);
  }

  return { reportId, driveLink: privateLink };
}
