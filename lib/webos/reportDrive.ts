import "server-only";

import { createSign, randomUUID } from "node:crypto";
import { appendSheetValues, fetchSheetRanges } from "@/lib/data/googleSheets";
import type { AccessContext } from "@/lib/webos/access";
import { getClinicalWorkspace } from "@/lib/webos/clinical";

type SheetValue = string | number | boolean;

type Credentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const BOT_REPORT_FOLDER_ID = "15EV0Oo_yoM0Ec3hISIfx9l6mezAMfNv1";
let tokenCache: { token: string; expiresAt: number } | null = null;

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
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${v.year}-${v.month}-${v.day}`;
  return {
    date,
    timestamp: `${date} ${v.hour}:${v.minute}`,
    provenance: ref.toISOString(),
  };
}

function loadCredentials(): Credentials | null {
  for (const raw of [
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    process.env.GOOGLE_CREDENTIALS_JSON,
  ]) {
    if (!raw?.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<Credentials>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
          token_uri: parsed.token_uri,
        };
      }
    } catch {
      continue;
    }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const key =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) return null;
  return { client_email: email, private_key: key.replace(/\\n/g, "\n") };
}

export function reportDriveReady(): boolean {
  return Boolean(loadCredentials() && (process.env.REPORTS_DRIVE_FOLDER_ID || BOT_REPORT_FOLDER_ID));
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function driveAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const credentials = loadCredentials();
  if (!credentials) throw new Error("DRIVE_CREDENTIALS_NOT_CONFIGURED");
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`DRIVE_AUTH_HTTP_${response.status}`);
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("DRIVE_AUTH_EMPTY_TOKEN");
  const expiresIn = Math.max(120, payload.expires_in || 3600);
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };
  return payload.access_token;
}

async function uploadToDrive(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string
): Promise<{ id: string; webViewLink: string }> {
  const token = await driveAccessToken();
  const folderId = process.env.REPORTS_DRIVE_FOLDER_ID || BOT_REPORT_FOLDER_ID;
  const boundary = `relife_${randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(`DRIVE_UPLOAD_HTTP_${response.status}`);
  }
  const payload = (await response.json()) as { id?: string; webViewLink?: string };
  if (!payload.id) throw new Error("DRIVE_UPLOAD_NO_ID");
  return {
    id: payload.id,
    webViewLink: payload.webViewLink || `https://drive.google.com/file/d/${payload.id}/view`,
  };
}

export async function uploadPhysioReport(
  context: AccessContext,
  input: {
    patientId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }
): Promise<{ reportId: string; driveLink: string }> {
  const patientId = normalize(input.patientId);
  const fileName = normalize(input.fileName).replace(/[\\/]/g, "_").slice(0, 180);
  const mimeType = normalize(input.mimeType) || "application/octet-stream";
  if (!patientId || !fileName) throw new Error("REPORT_FIELDS_REQUIRED");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error("REPORT_FILE_SIZE_INVALID");
  }
  const allowedMime = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]);
  if (!allowedMime.has(mimeType)) throw new Error("REPORT_FILE_TYPE_INVALID");

  const workspace = await getClinicalWorkspace(context, patientId);
  if (!workspace.canWrite) throw new Error("ACCESS_DENIED");
  const snapshot = await fetchSheetRanges("physio", ["14_Reports"]);
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

  const uploaded = await uploadToDrive(input.bytes, fileName, mimeType);
  const now = dhakaNow();
  await appendSheetValues("physio", "'14_Reports'!A:Z", [
    rowForHeaders(headers, {
      Report_ID: reportId,
      Patient_ID: patientId,
      Patient_Name: workspace.patient.fullName,
      File_Telegram_ID: "",
      File_Name: fileName,
      File_Type: mimeType,
      Upload_Date: now.date,
      Uploaded_By: context.staffId,
      File_Drive_Link: uploaded.webViewLink,
      Organization_ID: "RELIFE",
      Clinic_ID: "RELIFE-PHYSIO",
      Branch_ID: "AMTALI-01",
      Record_ID: `RELIFE-PHYSIO:${reportId}`,
      Encounter_ID: workspace.sessions[0]?.treatmentId || "",
      Provider_ID: context.staffId,
      Source_System: "web_pwa",
      Source_Type: "human_upload",
      AI_Generated: false,
      Human_Verified: true,
      Schema_Version: "relife-uda-v1",
      Provenance_Timestamp: now.provenance,
      Department: "Physio",
    }),
  ]);
  try {
    await appendSheetValues("physio", "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      context.staffId,
      "report.upload",
      "PatientReport",
      reportId,
      patientId,
      "",
      JSON.stringify({ fileName, mimeType, driveFileId: uploaded.id }),
      "Web PWA report upload to bot-compatible Drive folder",
      "RELIFE",
      "RELIFE-PHYSIO",
      "AMTALI-01",
      `RELIFE-PHYSIO:${reportId}`,
      workspace.sessions[0]?.treatmentId || "",
      context.staffId,
      "web_pwa",
      "human_upload",
      false,
      true,
      "relife-uda-v1",
      now.provenance,
      "Physio",
    ]]);
  } catch (error) {
    console.error("Report audit append failed", error);
  }
  return { reportId, driveLink: uploaded.webViewLink };
}
