import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
} from "@/lib/data/googleSheets";
import type { AccessContext } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";

type SheetValue = string | number | boolean;

export type ProfileSettingsInput = {
  fullName: string;
  phone?: string;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value: unknown): string {
  const digits = normalize(value).replace(/\D/g, "");
  return digits.startsWith("880") ? digits.slice(3) : digits;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map((header) => normalized(header));
  for (const name of names) {
    const index = values.indexOf(normalized(name));
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function cellValue(value: SheetValue) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value } };
}

function updateCellRequest(
  sheetId: number,
  rowNumber: number,
  columnNumber: number,
  value: SheetValue
): SpreadsheetBatchRequest {
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

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [normalized(key), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function appendRowRequest(sheetId: number, row: SheetValue[]): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    timestamp: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`,
    provenance: ref.toISOString(),
  };
}

function auditRow(
  headers: string[],
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  beforeValue: Record<string, string>,
  afterValue: Record<string, string>,
  department: string
): SheetValue[] {
  const now = dhakaNow();
  const auditId = `AUD-${randomUUID()}`;
  return rowForHeaders(headers, {
    Audit_ID: auditId,
    Timestamp: now.timestamp,
    Actor_ID: context.staffId,
    Action: "profile.update_self",
    Entity_Type: "Staff",
    Entity_ID: context.staffId,
    Patient_ID: "",
    Before_Value: JSON.stringify(beforeValue),
    After_Value: JSON.stringify(afterValue),
    Reason: "Staff updated own profile name/phone",
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: "AMTALI-01",
    Record_ID: `${clinicId}:${auditId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: department,
  });
}

export async function updateOwnProfile(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: ProfileSettingsInput
): Promise<{ fullName: string; phone: string }> {
  const staffId = normalize(context.staffId);
  if (!staffId || !normalize(organizationId) || !normalize(clinicId)) {
    throw new Error("ACCESS_DENIED");
  }

  const fullName = normalize(input.fullName).replace(/\s+/g, " ").slice(0, 120);
  if (fullName.length < 2) throw new Error("PROFILE_NAME_REQUIRED");

  const phone = normalizePhone(input.phone).slice(0, 15);
  if (phone && (phone.length < 10 || phone.length > 15)) {
    throw new Error("INVALID_PROFILE_PHONE");
  }

  return withMutationLock(`staff-profile:${organizationId}:${clinicId}:${staffId}`, async () => {
    const [snapshot, properties] = await Promise.all([
      fetchSheetRanges("physio", ["08_Staff", "20_Data_Audit"]),
      getSheetProperties("physio"),
    ]);
    const staffRows = snapshot["08_Staff"] || [];
    const auditRows = snapshot["20_Data_Audit"] || [];
    if (staffRows.length < 1 || auditRows.length < 1) {
      throw new Error("PROFILE_SCHEMA_MISMATCH");
    }

    const headers = staffRows[0];
    const staffIdIdx = headerIndex(headers, "Staff_ID");
    const nameIdx = headerIndex(headers, "Full_Name");
    const phoneIdx = headerIndex(headers, "Phone");
    const departmentIdx = headerIndex(headers, "Primary_Department", "Department");
    const organizationIdx = headerIndex(headers, "Organization_ID");
    const clinicIdx = headerIndex(headers, "Clinic_ID");
    if ([staffIdIdx, nameIdx, phoneIdx, organizationIdx, clinicIdx].some((index) => index < 0)) {
      throw new Error("PROFILE_SCHEMA_MISMATCH");
    }

    const dataIndex = staffRows.slice(1).findIndex(
      (row) =>
        at(row, staffIdIdx) === staffId &&
        at(row, organizationIdx) === organizationId &&
        at(row, clinicIdx) === clinicId
    );
    if (dataIndex < 0) throw new Error("PROFILE_NOT_FOUND");

    const duplicate = phone && staffRows.slice(1).some((row) => {
      const rowStaffId = at(row, staffIdIdx);
      return (
        rowStaffId !== staffId &&
        at(row, organizationIdx) === organizationId &&
        at(row, clinicIdx) === clinicId &&
        normalizePhone(at(row, phoneIdx)) === phone
      );
    });
    if (duplicate) throw new Error("PROFILE_PHONE_DUPLICATE");

    const sheetIds = new Map(properties.map((item) => [item.title, item.sheetId]));
    const staffSheetId = sheetIds.get("08_Staff");
    const auditSheetId = sheetIds.get("20_Data_Audit");
    if (typeof staffSheetId !== "number" || typeof auditSheetId !== "number") {
      throw new Error("PROFILE_SCHEMA_MISMATCH");
    }

    const row = staffRows[dataIndex + 1];
    const before = {
      fullName: at(row, nameIdx),
      phone: normalizePhone(at(row, phoneIdx)),
    };
    const after = { fullName, phone };
    const rowNumber = dataIndex + 2;
    const department = at(row, departmentIdx) || "Physio";

    const requests: SpreadsheetBatchRequest[] = [
      updateCellRequest(staffSheetId, rowNumber, nameIdx + 1, fullName),
      updateCellRequest(staffSheetId, rowNumber, phoneIdx + 1, phone),
      appendRowRequest(
        auditSheetId,
        auditRow(
          auditRows[0],
          context,
          organizationId,
          clinicId,
          before,
          after,
          department
        )
      ),
    ];

    await batchUpdateSpreadsheet("physio", requests);
    return after;
  });
}
