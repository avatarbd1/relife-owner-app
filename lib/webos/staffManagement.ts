import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
} from "@/lib/data/googleSheets";
import type { Department } from "@/lib/types";
import type { AccessContext, WebRole } from "@/lib/webos/access";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

type SheetValue = string | number | boolean;
type ManagedRole = Exclude<WebRole, "Owner">;

const MANAGED_ROLES = new Set<ManagedRole>([
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
  "Dental_Assistant",
  "Auditor",
  "System Admin",
]);
const DEPARTMENTS = new Set<Department>(["Physio", "Dental", "All"]);

export interface ManagedStaffRecord {
  staffId: string;
  fullName: string;
  phone: string;
  telegramId: string;
  status: "Active" | "Inactive";
  primaryDepartment: Department;
  role: ManagedRole;
  roles: WebRole[];
  departmentAccess: Department[];
  salary: number;
  clinicalWriteScope: string;
  financialAccess: string;
}

export interface StaffMutationInput {
  fullName: string;
  phone?: string;
  role: string;
  primaryDepartment: string;
  departmentAccess: string[];
  salary?: number;
  clinicalWriteScope?: string;
  status?: string;
}

type NormalizedStaffInput = {
  fullName: string;
  phone: string;
  role: ManagedRole;
  primaryDepartment: Department;
  departmentAccess: Department[];
  salary: number;
  clinicalWriteScope: string;
  status: "Active" | "Inactive";
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

function money(value: unknown): number {
  const parsed = Number(normalize(value).replace(/[৳,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [normalized(key), value])
  );
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
  if (!context.staffId.trim() || !context.roles.includes("Owner")) {
    throw new Error("ACCESS_DENIED");
  }
}

function parseRole(value: unknown): ManagedRole {
  const raw = normalize(value);
  const aliases: Record<string, ManagedRole> = {
    manager: "Manager",
    receptionist: "Receptionist",
    therapist: "Therapist",
    physiotherapist: "Therapist",
    dentist: "Dentist",
    dental_assistant: "Dental_Assistant",
    "dental assistant": "Dental_Assistant",
    auditor: "Auditor",
    system_admin: "System Admin",
    "system admin": "System Admin",
  };
  const role = aliases[raw.toLowerCase()] || (raw as ManagedRole);
  if (!MANAGED_ROLES.has(role)) throw new Error("INVALID_STAFF_ROLE");
  return role;
}

function parseDepartment(value: unknown): Department {
  const raw = normalize(value) as Department;
  if (!DEPARTMENTS.has(raw)) throw new Error("INVALID_STAFF_DEPARTMENT");
  return raw;
}

function normalizeDepartments(values: unknown): Department[] {
  if (!Array.isArray(values)) throw new Error("INVALID_STAFF_DEPARTMENT_ACCESS");
  const departments = [...new Set(values.map(parseDepartment))];
  if (departments.length === 0) throw new Error("INVALID_STAFF_DEPARTMENT_ACCESS");
  if (departments.includes("All")) return ["All"];
  return departments;
}

function validateRoleDepartment(
  role: ManagedRole,
  primaryDepartment: Department,
  departmentAccess: Department[]
): void {
  const permits = (department: Department) =>
    departmentAccess.includes("All") || departmentAccess.includes(department);

  if (primaryDepartment !== "All" && !permits(primaryDepartment)) {
    throw new Error("PRIMARY_DEPARTMENT_OUTSIDE_ACCESS");
  }
  if (role === "Therapist" && (primaryDepartment !== "Physio" || !permits("Physio"))) {
    throw new Error("THERAPIST_DEPARTMENT_INVALID");
  }
  if (
    (role === "Dentist" || role === "Dental_Assistant") &&
    (primaryDepartment !== "Dental" || !permits("Dental"))
  ) {
    throw new Error("DENTAL_ROLE_DEPARTMENT_INVALID");
  }
}

function normalizeInput(
  input: StaffMutationInput,
  fallbackStatus: "Active" | "Inactive" = "Active"
): NormalizedStaffInput {
  const fullName = normalize(input.fullName).replace(/\s+/g, " ").slice(0, 120);
  if (fullName.length < 2) throw new Error("STAFF_NAME_REQUIRED");

  const phone = normalizePhone(input.phone).slice(0, 15);
  if (phone && (phone.length < 10 || phone.length > 15)) {
    throw new Error("INVALID_STAFF_PHONE");
  }

  const role = parseRole(input.role);
  const primaryDepartment = parseDepartment(input.primaryDepartment);
  const departmentAccess = normalizeDepartments(input.departmentAccess);
  validateRoleDepartment(role, primaryDepartment, departmentAccess);

  const salary = Number(input.salary ?? 0);
  if (!Number.isFinite(salary) || salary < 0 || salary > 10_000_000) {
    throw new Error("INVALID_STAFF_SALARY");
  }

  const requestedClinical = normalize(input.clinicalWriteScope);
  const canUseDentalTemporary =
    role === "Receptionist" &&
    primaryDepartment === "Dental" &&
    departmentAccess.length === 1 &&
    departmentAccess[0] === "Dental";
  const clinicalWriteScope =
    requestedClinical === "Dental_Temporary_Data_Entry" && canUseDentalTemporary
      ? "Dental_Temporary_Data_Entry"
      : "";

  const statusRaw = normalize(input.status || fallbackStatus).toLowerCase();
  const status = statusRaw === "inactive" ? "Inactive" : "Active";

  return {
    fullName,
    phone,
    role,
    primaryDepartment,
    departmentAccess,
    salary: Math.round(salary * 100) / 100,
    clinicalWriteScope,
    status,
  };
}

async function sheetIdMap(): Promise<Map<string, number>> {
  const properties = await getSheetProperties("physio");
  return new Map(properties.map((item) => [item.title, item.sheetId]));
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("STAFF_SCHEMA_MISMATCH");
  return id;
}

async function readStaffMutationSnapshot() {
  const [snapshot, ids] = await Promise.all([
    fetchSheetRanges("physio", ["08_Staff", "Staff_Department_Access", "20_Data_Audit"]),
    sheetIdMap(),
  ]);
  const staffRows = snapshot["08_Staff"] || [];
  const accessRows = snapshot["Staff_Department_Access"] || [];
  const auditRows = snapshot["20_Data_Audit"] || [];
  if (staffRows.length < 1 || accessRows.length < 1 || auditRows.length < 1) {
    throw new Error("STAFF_SCHEMA_MISMATCH");
  }

  const staffHeaders = staffRows[0];
  const staffIdIdx = headerIndex(staffHeaders, "Staff_ID");
  const fullNameIdx = headerIndex(staffHeaders, "Full_Name");
  const roleIdx = headerIndex(staffHeaders, "Role");
  const statusIdx = headerIndex(staffHeaders, "Status");
  const primaryDepartmentIdx = headerIndex(staffHeaders, "Primary_Department", "Department");
  const salaryIdx = headerIndex(staffHeaders, "Salary");
  if ([staffIdIdx, fullNameIdx, roleIdx, statusIdx, primaryDepartmentIdx, salaryIdx].some((index) => index < 0)) {
    throw new Error("STAFF_SCHEMA_MISMATCH");
  }

  const accessHeaders = accessRows[0];
  const accessStaffIdIdx = headerIndex(accessHeaders, "Staff_ID");
  const accessDepartmentIdx = headerIndex(accessHeaders, "Department");
  const accessStatusIdx = headerIndex(accessHeaders, "Status");
  if ([accessStaffIdIdx, accessDepartmentIdx, accessStatusIdx].some((index) => index < 0)) {
    throw new Error("STAFF_SCHEMA_MISMATCH");
  }

  return {
    ids,
    staffRows,
    accessRows,
    auditRows,
    staffHeaders,
    accessHeaders,
    staffIdIdx,
    fullNameIdx,
    roleIdx,
    statusIdx,
    primaryDepartmentIdx,
    salaryIdx,
    phoneIdx: headerIndex(staffHeaders, "Phone"),
    telegramIdx: headerIndex(staffHeaders, "Telegram_ID"),
    departmentAccessIdx: headerIndex(staffHeaders, "Department_Access"),
    clinicalIdx: headerIndex(staffHeaders, "Clinical_Write_Scope"),
    financialIdx: headerIndex(staffHeaders, "Financial_Access"),
    accessStaffIdIdx,
    accessDepartmentIdx,
    accessStatusIdx,
  };
}

function staffRowIndexById(snapshot: Awaited<ReturnType<typeof readStaffMutationSnapshot>>, staffId: string): number {
  return snapshot.staffRows.slice(1).findIndex(
    (row) => at(row, snapshot.staffIdIdx) === staffId
  );
}

function ensureUniquePhone(
  snapshot: Awaited<ReturnType<typeof readStaffMutationSnapshot>>,
  phone: string,
  exceptStaffId = ""
): void {
  if (!phone || snapshot.phoneIdx < 0) return;
  const conflict = snapshot.staffRows.slice(1).some((row) => {
    const staffId = at(row, snapshot.staffIdIdx);
    return staffId !== exceptStaffId && normalizePhone(at(row, snapshot.phoneIdx)) === phone;
  });
  if (conflict) throw new Error("STAFF_PHONE_DUPLICATE");
}

function staffSummary(
  snapshot: Awaited<ReturnType<typeof readStaffMutationSnapshot>>,
  row: string[]
): Record<string, unknown> {
  return {
    staffId: at(row, snapshot.staffIdIdx),
    fullName: at(row, snapshot.fullNameIdx),
    phone: snapshot.phoneIdx >= 0 ? normalizePhone(at(row, snapshot.phoneIdx)) : "",
    role: at(row, snapshot.roleIdx),
    status: at(row, snapshot.statusIdx) || "Active",
    primaryDepartment: at(row, snapshot.primaryDepartmentIdx),
    salary: money(at(row, snapshot.salaryIdx)),
    clinicalWriteScope: snapshot.clinicalIdx >= 0 ? at(row, snapshot.clinicalIdx) : "",
    financialAccess: snapshot.financialIdx >= 0 ? at(row, snapshot.financialIdx) : "",
  };
}

function appendAccessRows(
  snapshot: Awaited<ReturnType<typeof readStaffMutationSnapshot>>,
  accessSheetId: number,
  staffId: string,
  input: NormalizedStaffInput,
  financialAccess: string
): SpreadsheetBatchRequest[] {
  if (input.status !== "Active") return [];
  return input.departmentAccess.map((department) =>
    appendRowRequest(
      accessSheetId,
      rowForHeaders(snapshot.accessHeaders, {
        Staff_ID: staffId,
        Department: department,
        Role_Snapshot: input.role,
        Role: input.role,
        Status: "Active",
        Clinical_Write_Scope: input.clinicalWriteScope,
        Financial_Access: financialAccess,
      })
    )
  );
}

function deactivateExistingAccessRequests(
  snapshot: Awaited<ReturnType<typeof readStaffMutationSnapshot>>,
  accessSheetId: number,
  staffId: string
): SpreadsheetBatchRequest[] {
  const requests: SpreadsheetBatchRequest[] = [];
  snapshot.accessRows.slice(1).forEach((row, index) => {
    if (
      at(row, snapshot.accessStaffIdIdx) === staffId &&
      at(row, snapshot.accessStatusIdx).toLowerCase() !== "inactive"
    ) {
      requests.push(
        updateCellRequest(accessSheetId, index + 2, snapshot.accessStatusIdx + 1, "Inactive")
      );
    }
  });
  return requests;
}

function auditRow(
  headers: string[],
  actorId: string,
  action: string,
  staffId: string,
  department: Department,
  organizationId: string,
  clinicId: string,
  beforeValue: unknown,
  afterValue: unknown,
  reason: string
): SheetValue[] {
  const now = dhakaNow();
  const auditId = `AUD-${randomUUID()}`;
  return rowForHeaders(headers, {
    Audit_ID: auditId,
    Timestamp: now.timestamp,
    Actor_ID: actorId,
    Action: action,
    Entity_Type: "Staff",
    Entity_ID: staffId,
    Patient_ID: "",
    Before_Value: JSON.stringify(beforeValue),
    After_Value: JSON.stringify(afterValue),
    Reason: reason,
    Organization_ID: organizationId,
    Clinic_ID: clinicId,
    Branch_ID: "AMTALI-01",
    Record_ID: `${organizationId}:${auditId}`,
    Provider_ID: actorId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: department,
  });
}

function generateStaffId(): string {
  return `STF-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export async function listManagedStaff(context: AccessContext, organizationId: string, clinicId: string): Promise<ManagedStaffRecord[]> {
  assertOwner(context);
  const [directory, raw] = await Promise.all([
    getWebStaffDirectory(),
    fetchSheetRanges("physio", ["08_Staff"]),
  ]);
  const staffRows = raw["08_Staff"] || [];
  if (staffRows.length < 1) throw new Error("STAFF_SCHEMA_MISMATCH");
  const headers = staffRows[0];
  const idIdx = headerIndex(headers, "Staff_ID");
  const salaryIdx = headerIndex(headers, "Salary");
  const salaryById = new Map(
    staffRows.slice(1).map((row) => [at(row, idIdx), money(at(row, salaryIdx))])
  );

  return directory.flatMap((item) => {
    if (item.roles.includes("Owner")) return [];
    const role = item.roles.find((candidate): candidate is ManagedRole => MANAGED_ROLES.has(candidate as ManagedRole));
    if (!role || !item.primaryDepartment) return [];
    return [{
      staffId: item.staffId,
      fullName: item.fullName,
      phone: item.phone,
      telegramId: item.telegramId,
      status: item.status,
      primaryDepartment: item.primaryDepartment,
      role,
      roles: item.roles,
      departmentAccess: item.departmentAccess,
      salary: salaryById.get(item.staffId) || 0,
      clinicalWriteScope: item.clinicalWriteScope,
      financialAccess: item.financialAccess,
    }];
  });
}

export async function createManagedStaff(context: AccessContext, organizationId: string, clinicId: string, input: StaffMutationInput) {
  assertOwner(context);
  const normalizedInput = normalizeInput(input, "Active");

  return withMutationLock("staff-management:create", async () => {
    const snapshot = await readStaffMutationSnapshot();
    ensureUniquePhone(snapshot, normalizedInput.phone);

    let staffId = generateStaffId();
    for (let attempt = 0; attempt < 5 && staffRowIndexById(snapshot, staffId) >= 0; attempt += 1) {
      staffId = generateStaffId();
    }
    if (staffRowIndexById(snapshot, staffId) >= 0) throw new Error("STAFF_ID_COLLISION");

    const staffSheetId = requireSheetId(snapshot.ids, "08_Staff");
    const accessSheetId = requireSheetId(snapshot.ids, "Staff_Department_Access");
    const auditSheetId = requireSheetId(snapshot.ids, "20_Data_Audit");
    const baseAccess = normalizedInput.departmentAccess.includes("All")
      ? "All"
      : normalizedInput.primaryDepartment;

    const staffRow = rowForHeaders(snapshot.staffHeaders, {
      Staff_ID: staffId,
      Full_Name: normalizedInput.fullName,
      Phone: normalizedInput.phone,
      Telegram_ID: "",
      Role: normalizedInput.role,
      Status: "Active",
      Primary_Department: normalizedInput.primaryDepartment,
      Department: normalizedInput.primaryDepartment,
      Department_Access: baseAccess,
      Clinical_Write_Scope: normalizedInput.clinicalWriteScope,
      Financial_Access: "",
      Salary: normalizedInput.salary,
    });
    const after = { staffId, ...normalizedInput };
    const requests: SpreadsheetBatchRequest[] = [
      appendRowRequest(staffSheetId, staffRow),
      ...appendAccessRows(snapshot, accessSheetId, staffId, normalizedInput, ""),
      appendRowRequest(
        auditSheetId,
        auditRow(
          snapshot.auditRows[0],
          context.staffId,
          "staff.create",
          staffId,
          normalizedInput.primaryDepartment,
          organizationId,
          clinicId,
          {},
          after,
          "Owner created staff access profile"
        )
      ),
    ];
    await batchUpdateSpreadsheet("physio", requests);
    return { staffId, status: "Active" as const };
  });
}

export async function updateManagedStaff(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  staffIdInput: string,
  input: StaffMutationInput
) {
  assertOwner(context);
  const staffId = normalize(staffIdInput);
  if (!staffId) throw new Error("STAFF_ID_REQUIRED");

  return withMutationLock(`staff-management:${staffId}`, async () => {
    const snapshot = await readStaffMutationSnapshot();
    const dataIndex = staffRowIndexById(snapshot, staffId);
    if (dataIndex < 0) throw new Error("STAFF_NOT_FOUND");
    const row = snapshot.staffRows[dataIndex + 1];
    if (at(row, snapshot.roleIdx) === "Owner") throw new Error("OWNER_PROFILE_IMMUTABLE");

    const previous = staffSummary(snapshot, row);
    const fallbackStatus = normalized(previous.status).toLowerCase() === "inactive" ? "Inactive" : "Active";
    const normalizedInput = normalizeInput(input, fallbackStatus);
    ensureUniquePhone(snapshot, normalizedInput.phone, staffId);

    const staffSheetId = requireSheetId(snapshot.ids, "08_Staff");
    const accessSheetId = requireSheetId(snapshot.ids, "Staff_Department_Access");
    const auditSheetId = requireSheetId(snapshot.ids, "20_Data_Audit");
    const rowNumber = dataIndex + 2;
    const requests: SpreadsheetBatchRequest[] = [];
    const set = (index: number, value: SheetValue) => {
      if (index >= 0) requests.push(updateCellRequest(staffSheetId, rowNumber, index + 1, value));
    };

    set(snapshot.fullNameIdx, normalizedInput.fullName);
    set(snapshot.phoneIdx, normalizedInput.phone);
    set(snapshot.roleIdx, normalizedInput.role);
    set(snapshot.statusIdx, normalizedInput.status);
    set(snapshot.primaryDepartmentIdx, normalizedInput.primaryDepartment);
    set(snapshot.salaryIdx, normalizedInput.salary);
    set(
      snapshot.departmentAccessIdx,
      normalizedInput.departmentAccess.includes("All") ? "All" : normalizedInput.primaryDepartment
    );
    set(snapshot.clinicalIdx, normalizedInput.clinicalWriteScope);

    const financialAccess = snapshot.financialIdx >= 0 ? at(row, snapshot.financialIdx) : "";
    requests.push(...deactivateExistingAccessRequests(snapshot, accessSheetId, staffId));
    requests.push(
      ...appendAccessRows(snapshot, accessSheetId, staffId, normalizedInput, financialAccess)
    );

    const after = { staffId, ...normalizedInput, financialAccess };
    const action =
      fallbackStatus === "Inactive" && normalizedInput.status === "Active"
        ? "staff.reactivate"
        : "staff.update";
    requests.push(
      appendRowRequest(
        auditSheetId,
        auditRow(
          snapshot.auditRows[0],
          context.staffId,
          action,
          staffId,
          normalizedInput.primaryDepartment,
          organizationId,
          clinicId,
          previous,
          after,
          action === "staff.reactivate"
            ? "Owner reactivated staff access profile"
            : "Owner updated staff access profile"
        )
      )
    );

    await batchUpdateSpreadsheet("physio", requests);
    return { staffId, status: normalizedInput.status };
  });
}

export async function deactivateManagedStaff(context: AccessContext, organizationId: string, clinicId: string, staffIdInput: string) {
  assertOwner(context);
  const staffId = normalize(staffIdInput);
  if (!staffId) throw new Error("STAFF_ID_REQUIRED");

  return withMutationLock(`staff-management:${staffId}`, async () => {
    const snapshot = await readStaffMutationSnapshot();
    const dataIndex = staffRowIndexById(snapshot, staffId);
    if (dataIndex < 0) throw new Error("STAFF_NOT_FOUND");
    const row = snapshot.staffRows[dataIndex + 1];
    if (at(row, snapshot.roleIdx) === "Owner") throw new Error("OWNER_PROFILE_IMMUTABLE");
    if (at(row, snapshot.statusIdx).toLowerCase() === "inactive") {
      return { staffId, status: "Inactive" as const, changed: false };
    }

    const previous = staffSummary(snapshot, row);
    const staffSheetId = requireSheetId(snapshot.ids, "08_Staff");
    const accessSheetId = requireSheetId(snapshot.ids, "Staff_Department_Access");
    const auditSheetId = requireSheetId(snapshot.ids, "20_Data_Audit");
    const rowNumber = dataIndex + 2;
    const department = (() => {
      const value = at(row, snapshot.primaryDepartmentIdx) as Department;
      return DEPARTMENTS.has(value) ? value : "All";
    })();

    const requests: SpreadsheetBatchRequest[] = [
      updateCellRequest(staffSheetId, rowNumber, snapshot.statusIdx + 1, "Inactive"),
      ...deactivateExistingAccessRequests(snapshot, accessSheetId, staffId),
      appendRowRequest(
        auditSheetId,
        auditRow(
          snapshot.auditRows[0],
          context.staffId,
          "staff.deactivate",
          staffId,
          department,
          organizationId,
          clinicId,
          previous,
          { ...previous, status: "Inactive" },
          "Owner deactivated staff access profile"
        )
      ),
    ];
    await batchUpdateSpreadsheet("physio", requests);
    return { staffId, status: "Inactive" as const, changed: true };
  });
}
