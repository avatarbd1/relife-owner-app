import "server-only";

import { NextResponse } from "next/server";
import {
  fetchSheetRanges,
  updateSheetValues,
  type Workbook,
} from "@/lib/data/googleSheets";

const REPORT_BUCKET = "relife-patient-reports";
const STORAGE_LINK_PREFIX = `supabase://${REPORT_BUCKET}/`;
const DEFAULT_EDGE_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-report-storage";
const MAX_BATCH = 10;

type Department = "Physio" | "Dental";

type MigrationResult = {
  department: Department;
  reportId: string;
  patientId: string;
  status: "migrated" | "skipped" | "failed";
  detail?: string;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => normalized(header) === name.toLowerCase());
}

function columnName(index: number): string {
  let n = index + 1;
  let value = "";
  while (n > 0) {
    n -= 1;
    value = String.fromCharCode(65 + (n % 26)) + value;
    n = Math.floor(n / 26);
  }
  return value;
}

function safeSegment(value: string, fallback: string): string {
  const sanitized = normalize(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, 160);
  return sanitized || fallback;
}

function fileNameFor(row: string[], headers: string[], reportId: string): string {
  const fileNameIdx = headerIndex(headers, "File_Name");
  const raw = fileNameIdx >= 0 ? normalize(row[fileNameIdx]) : "";
  return safeSegment(raw, `${reportId}.jpg`);
}

function mimeFromFileName(fileName: string, upstream: string): string {
  const upstreamBase = upstream.split(";", 1)[0]?.trim().toLowerCase() || "";
  if (upstreamBase.startsWith("image/") || upstreamBase === "application/pdf") {
    return upstreamBase;
  }
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  };
  return byExtension[extension] || "image/jpeg";
}

function workbookFor(department: Department): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function storageRootFor(department: Department): string {
  return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}

function migrationConfig() {
  const migrationKey = process.env.LEGACY_MEDIA_MIGRATION_KEY?.trim();
  const botToken = process.env.BOT_TOKEN?.trim();
  const storageSecret = process.env.REPORT_STORAGE_EDGE_SECRET?.trim();
  const organizationId = process.env.LEGACY_MEDIA_MIGRATION_ORGANIZATION_ID?.trim();
  const clinicId = process.env.LEGACY_MEDIA_MIGRATION_CLINIC_ID?.trim();
  const edgeUrl = (
    process.env.REPORT_STORAGE_EDGE_URL?.trim() || DEFAULT_EDGE_URL
  ).replace(/\/+$/, "");
  const missing = [
    ["LEGACY_MEDIA_MIGRATION_KEY", migrationKey],
    ["BOT_TOKEN", botToken],
    ["REPORT_STORAGE_EDGE_SECRET", storageSecret],
    ["LEGACY_MEDIA_MIGRATION_ORGANIZATION_ID", organizationId],
    ["LEGACY_MEDIA_MIGRATION_CLINIC_ID", clinicId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`LEGACY_MEDIA_MIGRATION_NOT_CONFIGURED:${missing.join(",")}`);
  }
  return {
    migrationKey: migrationKey!,
    botToken: botToken!,
    storageSecret: storageSecret!,
    organizationId: organizationId!,
    clinicId: clinicId!,
    edgeUrl,
  };
}

async function telegramFile(botToken: string, fileId: string) {
  const metadata = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { cache: "no-store", signal: AbortSignal.timeout(20_000) }
  );
  const payload = (await metadata.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { file_path?: string };
    description?: string;
  };
  const filePath = normalize(payload.result?.file_path);
  if (!metadata.ok || !payload.ok || !filePath) {
    throw new Error(payload.description || `TELEGRAM_GET_FILE_HTTP_${metadata.status}`);
  }
  const response = await fetch(
    `https://api.telegram.org/file/bot${encodeURIComponent(botToken)}/${filePath}`,
    { cache: "no-store", signal: AbortSignal.timeout(35_000) }
  );
  if (!response.ok) throw new Error(`TELEGRAM_DOWNLOAD_HTTP_${response.status}`);
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function uploadAndVerify(input: {
  edgeUrl: string;
  storageSecret: string;
  path: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const fileBuffer = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(fileBuffer).set(input.bytes);
  const form = new FormData();
  form.set("path", input.path);
  form.set("file", new Blob([fileBuffer], { type: input.mimeType }), input.fileName);
  const upload = await fetch(input.edgeUrl, {
    method: "POST",
    headers: { "x-relife-report-key": input.storageSecret },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(40_000),
  });
  const payload = (await upload.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!upload.ok || !payload.ok) {
    throw new Error(payload.error || `REPORT_STORAGE_UPLOAD_HTTP_${upload.status}`);
  }

  const verify = await fetch(`${input.edgeUrl}?path=${encodeURIComponent(input.path)}`, {
    headers: { "x-relife-report-key": input.storageSecret },
    cache: "no-store",
    signal: AbortSignal.timeout(40_000),
  });
  if (!verify.ok) throw new Error(`REPORT_STORAGE_VERIFY_HTTP_${verify.status}`);
  const stored = await verify.arrayBuffer();
  if (stored.byteLength !== input.bytes.byteLength) {
    throw new Error(`REPORT_STORAGE_VERIFY_SIZE_MISMATCH_${stored.byteLength}_${input.bytes.byteLength}`);
  }
}

async function migrateDepartment(
  department: Department,
  limit: number,
  config: ReturnType<typeof migrationConfig>
): Promise<MigrationResult[]> {
  const workbook = workbookFor(department);
  const snapshot = await fetchSheetRanges(workbook, ["14_Reports"]);
  const rows = snapshot["14_Reports"] || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  const reportIdIdx = headerIndex(headers, "Report_ID");
  const patientIdIdx = headerIndex(headers, "Patient_ID");
  const telegramIdIdx = headerIndex(headers, "File_Telegram_ID");
  const driveLinkIdx = headerIndex(headers, "File_Drive_Link");
  const organizationIdIdx = headerIndex(headers, "Organization_ID");
  const clinicIdIdx = headerIndex(headers, "Clinic_ID");
  if (reportIdIdx < 0 || patientIdIdx < 0 || telegramIdIdx < 0 || driveLinkIdx < 0) {
    throw new Error(`${department.toUpperCase()}_REPORT_SCHEMA_MISMATCH`);
  }

  const candidates = rows
    .slice(1)
    .map((row, offset) => ({ row, sheetRow: offset + 2 }))
    .filter(({ row }) => {
      const reportId = normalize(row[reportIdIdx]);
      const fileId = normalize(row[telegramIdIdx]);
      const driveLink = normalize(row[driveLinkIdx]);
      return Boolean(reportId && fileId && !driveLink);
    })
    .slice(0, limit);

  const results: MigrationResult[] = [];
  for (const { row, sheetRow } of candidates) {
    const reportId = normalize(row[reportIdIdx]);
    const patientId = normalize(row[patientIdIdx]);
    const fileId = normalize(row[telegramIdIdx]);
    const fileName = fileNameFor(row, headers, reportId);
    try {
      const telegram = await telegramFile(config.botToken, fileId);
      if (telegram.body.byteLength < 1) throw new Error("TELEGRAM_FILE_EMPTY");
      const mimeType = mimeFromFileName(fileName, telegram.contentType);
      const path = [
        storageRootFor(department),
        safeSegment(patientId, "patient"),
        safeSegment(reportId, "report"),
        fileName,
      ].join("/");
      await uploadAndVerify({
        edgeUrl: config.edgeUrl,
        storageSecret: config.storageSecret,
        path,
        fileName,
        mimeType,
        bytes: telegram.body,
      });
      const privateLink = `${STORAGE_LINK_PREFIX}${path}`;
      await updateSheetValues(
        workbook,
        `'14_Reports'!${columnName(driveLinkIdx)}${sheetRow}:${columnName(driveLinkIdx)}${sheetRow}`,
        [[privateLink]]
      );
      if (organizationIdIdx >= 0) {
        await updateSheetValues(
          workbook,
          `'14_Reports'!${columnName(organizationIdIdx)}${sheetRow}:${columnName(organizationIdIdx)}${sheetRow}`,
          [[config.organizationId]]
        );
      }
      if (clinicIdIdx >= 0) {
        await updateSheetValues(
          workbook,
          `'14_Reports'!${columnName(clinicIdIdx)}${sheetRow}:${columnName(clinicIdIdx)}${sheetRow}`,
          [[config.clinicId]]
        );
      }
      results.push({ department, reportId, patientId, status: "migrated" });
    } catch (error) {
      results.push({
        department,
        reportId,
        patientId,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function POST(request: Request) {
  try {
    const config = migrationConfig();
    const supplied = request.headers.get("x-relife-migration-key")?.trim() || "";
    if (!supplied || supplied !== config.migrationKey) {
      return new NextResponse("Not found", { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      department?: Department | "All";
      limit?: number;
    };
    const requestedLimit = Number(body.limit || MAX_BATCH);
    const limit = Math.max(1, Math.min(MAX_BATCH, Number.isFinite(requestedLimit) ? requestedLimit : MAX_BATCH));
    const departments: Department[] =
      body.department === "Dental"
        ? ["Dental"]
        : body.department === "Physio"
          ? ["Physio"]
          : ["Physio", "Dental"];
    const results: MigrationResult[] = [];
    for (const department of departments) {
      results.push(...(await migrateDepartment(department, limit, config)));
    }
    return NextResponse.json({
      ok: results.every((item) => item.status !== "failed"),
      migrated: results.filter((item) => item.status === "migrated").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
    });
  } catch (error) {
    console.error("Legacy media migration failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
