import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
} from "@/lib/data/googleSheets";
import type { Department } from "@/lib/types";
import type { AccessContext } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";

type SheetValue = string | number | boolean;

const ALLOWED_DEPARTMENTS = new Set<Department>(["Physio", "Dental", "All"]);
const ALLOWED_ROLES = new Set([
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
  "Dental_Assistant",
  "Auditor",
  "System Admin",
]);

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

function money(value: unknown): number {
  const parsed = Number(normalize(value).replace(/[৳,]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalized);
  for (const name of names) {
    const index = values.indexOf(normalized(name));
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(Object.entries(values).map(([key, value]) => [normalized(key), value]));
  return headers.map((header) => map.get(normalized(header)) ?? "");
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

function assertOwner(context: AccessContext): void {
  if (!context.staffId.trim() || !context.roles.includes("Owner")) throw new Error("ACCESS_DENIED");
}

function parseDepartments(values: unknown): Department[] {
  if (!Array.isArray(values)) throw new Error("INVALID_STAFF_DEPARTMENT_ACCESS");
  const departments = [...new Set(values.map((value) => normalize(value) as Department))];
  if (departments.length === 0 || departments.some((value) => !ALLOWED_DEPARTMENTS.has(value))) {
    throw new Error("INVALID_STAFF_DEPARTMENT_ACCESS");
  }
  return departments.includes("All") ? ["All"] : departments;
}

function validateScope(role: string, primaryDepartment: Department, access: Department[]): void {
  const permits = (department: Department) => access.includes("All") || access.includes(department);
  if (primaryDepartment !== "All" && !permits(primaryDepartment)) {
    throw new Error("PRIMARY_DEPARTMENT_OUTSIDE_ACCESS");
  }
  if (role === "Therapist" && (primaryDepartment !== "Physio" || !permits("Physio"))) {
    throw new Error("THERAPIST_DEPARTMENT_INVALID");
  }
  if ((role === "Dentist" || role === "Dental_Assistant") && (primaryDepartment !== "Dental" || !permits("Dental"))) {
    throw new Error("DENTAL_ROLE_DEPARTMENT_INVALID");
  }
  if ((role === "Auditor" || role === "System Admin") && !access.includes("All")) {
    throw new Error("INVALID_STAFF_DEPARTMENT_ACCESS");
  }
}

export interface UndoStaffDeactivateInput {
  staffId: string;
  expectedProfile: {
    fullName: string;
    phone: string;
    role: string;
    primaryDepartment: string;
    salary: number;
    clinicalWriteScope: string;
    departmentAccess: string[];
  };
}

/**
 * Owner-only compare-before-reactivate command used by the short-lived UI
 * Undo affordance. The deactivate mutation changes only Status plus active
 * access rows, so any profile drift means another edit happened and Undo
 * fails closed instead of restoring stale permissions.
 */
export async function undoManagedStaffDeactivate(
  context: AccessContext,
  input: UndoStaffDeactivateInput
): Promise<{ staffId: string; status: "Active" }> {
  assertOwner(context);
  const staffId = normalize(input.staffId);
  if (!staffId) throw new Error("STAFF_ID_REQUIRED");
  const expected = input.expectedProfile;
  const role = normalize(expected.role);
  if (!ALLOWED_ROLES.has(role)) throw new Error("INVALID_STAFF_ROLE");
  const primaryDepartment = normalize(expected.primaryDepartment) as Department;
  if (!ALLOWED_DEPARTMENTS.has(primaryDepartment)) throw new Error("INVALID_STAFF_DEPARTMENT");
  const departmentAccess = parseDepartments(expected.departmentAccess);
  validateScope(role, primaryDepartment, departmentAccess);

  return withMutationLock(`staff-management:${staffId}`, async () => {
    const [snapshot, properties] = await Promise.all([
      fetchSheetRanges("physio", ["08_Staff", "Staff_Department_Access", "20_Data_Audit"]),
      getSheetProperties("physio"),
    ]);
    const staffRows = snapshot["08_Staff"] || [];
    const accessRows = snapshot["Staff_Department_Access"] || [];
    const auditRows = snapshot["20_Data_Audit"] || [];
    if (staffRows.length < 1 || accessRows.length < 1 || auditRows.length < 1) {
      throw new Error("STAFF_SCHEMA_MISMATCH");
    }

    const ids = new Map(properties.map((item) => [item.title, item.sheetId]));
    const staffSheetId = ids.get("08_Staff");
    const accessSheetId = ids.get("Staff_Department_Access");
    const auditSheetId = ids.get("20_Data_Audit");
    if ([staffSheetId, accessSheetId, auditSheetId].some((value) => typeof value !== "number")) {
      throw new Error("STAFF_SCHEMA_MISMATCH");
    }

    const staffHeaders = staffRows[0];
    const staffIdIdx = headerIndex(staffHeaders, "Staff_ID");
    const fullNameIdx = headerIndex(staffHeaders, "Full_Name");
    const phoneIdx = headerIndex(staffHeaders, "Phone");
    const roleIdx = headerIndex(staffHeaders, "Role");
    const statusIdx = headerIndex(staffHeaders, "Status");
    const primaryIdx = headerIndex(staffHeaders, "Primary_Department", "Department");
    const salaryIdx = headerIndex(staffHeaders, "Salary");
    const clinicalIdx = headerIndex(staffHeaders, "Clinical_Write_Scope");
    const financialIdx = headerIndex(staffHeaders, "Financial_Access");
    if ([staffIdIdx, fullNameIdx, roleIdx, statusIdx, primaryIdx, salaryIdx].some((index) => index < 0)) {
      throw new Error("STAFF_SCHEMA_MISMATCH");
    }

    const dataIndex = staffRows.slice(1).findIndex((row) => at(row, staffIdIdx) === staffId);
    if (dataIndex < 0) throw new Error("STAFF_NOT_FOUND");
    const row = staffRows[dataIndex + 1];
    if (at(row, roleIdx) === "Owner") throw new Error("OWNER_PROFILE_IMMUTABLE");
    if (normalized(at(row, statusIdx)) !== "inactive") throw new Error("STAFF_UNDO_CONFLICT");

    const profileMatches =
      normalized(at(row, fullNameIdx)) === normalized(expected.fullName) &&
      normalizePhone(at(row, phoneIdx)) === normalizePhone(expected.phone) &&
      at(row, roleIdx) === role &&
      at(row, primaryIdx) === primaryDepartment &&
      money(at(row, salaryIdx)) === money(expected.salary) &&
      normalize(at(row, clinicalIdx)) === normalize(expected.clinicalWriteScope);
    if (!profileMatches) throw new Error("STAFF_UNDO_CONFLICT");

    const accessHeaders = accessRows[0];
    const accessStaffIdx = headerIndex(accessHeaders, "Staff_ID");
    const accessStatusIdx = headerIndex(accessHeaders, "Status");
    if (accessStaffIdx < 0 || accessStatusIdx < 0) throw new Error("STAFF_SCHEMA_MISMATCH");
    const alreadyActive = accessRows.slice(1).some(
      (accessRow) => at(accessRow, accessStaffIdx) === staffId && normalized(at(accessRow, accessStatusIdx)) === "active"
    );
    if (alreadyActive) throw new Error("STAFF_UNDO_CONFLICT");

    const financialAccess = at(row, financialIdx);
    const requests: SpreadsheetBatchRequest[] = [
      updateCellRequest(staffSheetId as number, dataIndex + 2, statusIdx + 1, "Active"),
      ...departmentAccess.map((department) =>
        appendRowRequest(
          accessSheetId as number,
          rowForHeaders(accessHeaders, {
            Staff_ID: staffId,
            Department: department,
            Role_Snapshot: role,
            Role: role,
            Status: "Active",
            Clinical_Write_Scope: normalize(expected.clinicalWriteScope),
            Financial_Access: financialAccess,
          })
        )
      ),
    ];

    const now = dhakaNow();
    const auditId = `AUD-${randomUUID()}`;
    requests.push(
      appendRowRequest(
        auditSheetId as number,
        rowForHeaders(auditRows[0], {
          Audit_ID: auditId,
          Timestamp: now.timestamp,
          Actor_ID: context.staffId,
          Action: "staff.deactivate.undo",
          Entity_Type: "Staff",
          Entity_ID: staffId,
          Patient_ID: "",
          Before_Value: JSON.stringify({ status: "Inactive" }),
          After_Value: JSON.stringify({ status: "Active", departmentAccess }),
          Reason: "Owner undid recent staff deactivation after compare-before-reactivate check",
          Organization_ID: "RELIFE",
          Clinic_ID: primaryDepartment === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO",
          Branch_ID: "AMTALI-01",
          Record_ID: `RELIFE:${auditId}`,
          Provider_ID: context.staffId,
          Source_System: "web_pwa",
          Source_Type: "human_entry",
          AI_Generated: false,
          Human_Verified: true,
          Schema_Version: "relife-uda-v1",
          Provenance_Timestamp: now.provenance,
          Department: primaryDepartment,
        })
      )
    );

    await batchUpdateSpreadsheet("physio", requests);
    return { staffId, status: "Active" as const };
  });
}
