import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";
import { dhakaClockParts, RELIFE_SYSTEM } from "@/lib/config/relifeSystem";
import type { AccessContext } from "@/lib/webos/access";

export type SheetValue = string | number | boolean;

/**
 * 08_Staff / Staff_Department_Access / 20_Data_Audit are all read from the
 * "physio" workbook regardless of a staff member's own department
 * (lib/webos/staffDirectory.ts::getWebStaffDirectory,
 * lib/webos/staffManagement.ts::sheetIdMap). Staff_Shifts and Leave_Requests
 * are staff-master-adjacent, not per-department ledgers, so they follow the
 * same convention rather than splitting into two workbooks.
 */
export const WORKFORCE_WORKBOOK: Workbook = "physio";
export const DATA_AUDIT_SHEET = "20_Data_Audit";

const WORKFORCE_AUDIT_HEADERS = [
  "Audit_ID", "Timestamp", "Actor_ID", "Action", "Entity_Type", "Entity_ID",
  "Patient_ID", "Before_Value", "After_Value", "Reason", "Organization_ID",
  "Clinic_ID", "Branch_ID", "Record_ID", "Encounter_ID", "Provider_ID",
  "Source_System", "Source_Type", "AI_Generated",
  "Human_Verified", "Schema_Version", "Provenance_Timestamp", "Department",
] as const;

export function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedHeader(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

export function headerIndex(headers: string[], name: string): number {
  const needle = normalizedHeader(name);
  return headers.findIndex((header) => normalizedHeader(header) === needle);
}

export function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

export function rowForHeaders(
  headers: readonly string[],
  values: Record<string, SheetValue>
): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [normalizedHeader(key), value])
  );
  return headers.map((header) => map.get(normalizedHeader(header)) ?? "");
}

function cellValue(value: SheetValue): Record<string, unknown> {
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

export function appendRowRequest(sheetId: number, row: SheetValue[]): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}

export function updateCellRequest(
  sheetId: number,
  rowNumber: number,
  columnNumber: number,
  value: SheetValue
): SpreadsheetBatchRequest {
  if (rowNumber < 1 || columnNumber < 1) throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: columnNumber - 1,
        endColumnIndex: columnNumber,
      },
      rows: [{ values: [cellValue(value)] }],
      fields: "userEnteredValue",
    },
  };
}

export async function workforceSheetIdMap(): Promise<Map<string, number>> {
  const properties = await getSheetProperties(WORKFORCE_WORKBOOK);
  return new Map(properties.map((item) => [item.title, item.sheetId]));
}

export function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  return id;
}

/**
 * Fails closed with WORKFORCE_SCHEMA_NOT_PROVISIONED when the sheet or any
 * required header is absent (issue #153). Never creates the tab/headers —
 * live tab provisioning is a separately controlled operation.
 */
export async function readWorkforceSheet(
  sheetName: string,
  requiredHeaders: readonly string[]
): Promise<{ headers: string[]; dataRows: string[][] }> {
  requireSheetId(await workforceSheetIdMap(), sheetName);
  const snapshot = await fetchSheetRanges(WORKFORCE_WORKBOOK, [sheetName]);
  const rows = snapshot[sheetName] || [];
  if (rows.length < 1) throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  const headers = rows[0];
  const missingHeader = requiredHeaders.some((name) => headerIndex(headers, name) < 0);
  if (missingHeader) throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  return { headers, dataRows: rows.slice(1) };
}

export async function readDataAuditSheet(): Promise<{
  headers: string[];
  dataRows: string[][];
}> {
  requireSheetId(await workforceSheetIdMap(), DATA_AUDIT_SHEET);
  const snapshot = await fetchSheetRanges(WORKFORCE_WORKBOOK, [DATA_AUDIT_SHEET]);
  const rows = snapshot[DATA_AUDIT_SHEET] || [];
  if (rows.length < 1) throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  const headers = rows[0];
  if (WORKFORCE_AUDIT_HEADERS.some((name) => headerIndex(headers, name) < 0)) {
    throw new Error("WORKFORCE_SCHEMA_NOT_PROVISIONED");
  }
  return { headers, dataRows: rows.slice(1) };
}

export function buildWorkforceAuditRow(
  auditHeaders: string[],
  input: {
    context: AccessContext;
    action: string;
    entityType: "Shift" | "Leave";
    entityId: string;
    department: string;
    requestId: string;
    afterValue: Record<string, unknown>;
    reason: string;
    now: ReturnType<typeof dhakaClockParts>;
    organizationId: string;
    clinicId: string;
  }
): SheetValue[] {
  const auditId = `AUD-${randomUUID()}`;
  return rowForHeaders(auditHeaders, {
    Audit_ID: auditId,
    Timestamp: input.now.timestamp,
    Actor_ID: input.context.staffId,
    Action: input.action,
    Entity_Type: input.entityType,
    Entity_ID: input.entityId,
    Patient_ID: "",
    Before_Value: "",
    After_Value: JSON.stringify({ ...input.afterValue, requestId: input.requestId }),
    Reason: input.reason,
    Organization_ID: input.organizationId,
    Clinic_ID: input.clinicId,
    Branch_ID: RELIFE_SYSTEM.branchId,
    Record_ID: `${input.clinicId}:${input.entityId}`,
    Encounter_ID: "",
    Provider_ID: input.context.staffId,
    Source_System: RELIFE_SYSTEM.sourceSystem,
    Source_Type: RELIFE_SYSTEM.sourceType,
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: RELIFE_SYSTEM.schemaVersion,
    Provenance_Timestamp: input.now.provenance,
    Department: input.department,
  });
}

export async function commitWorkforceBatch(
  requests: SpreadsheetBatchRequest[]
): Promise<void> {
  await batchUpdateSpreadsheet(WORKFORCE_WORKBOOK, requests);
}

export function newEntityId(prefix: "SHF" | "LVE"): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}
