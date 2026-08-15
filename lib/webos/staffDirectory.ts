import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import type { Department } from "@/lib/types";
import type { AccessContext, WebRole } from "@/lib/webos/access";

const KNOWN_ROLES = new Set<WebRole>([
  "Owner",
  "Manager",
  "Receptionist",
  "Therapist",
  "Dentist",
  "Dental_Assistant",
  "Auditor",
  "System Admin",
]);

const KNOWN_DEPARTMENTS = new Set<Department>(["Physio", "Dental", "All"]);

export interface WebStaffIdentity {
  staffId: string;
  fullName: string;
  phone: string;
  telegramId: string;
  status: "Active" | "Inactive";
  primaryDepartment: Department | null;
  roles: WebRole[];
  departmentAccess: Department[];
  clinicalWriteScope: string;
  financialAccess: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((value) => normalize(value).toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function parseDepartment(value: string): Department | null {
  const exact = normalize(value) as Department;
  return KNOWN_DEPARTMENTS.has(exact) ? exact : null;
}

function parseRole(value: string): WebRole | null {
  const exact = normalize(value) as WebRole;
  return KNOWN_ROLES.has(exact) ? exact : null;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("880")) return digits.slice(3);
  return digits;
}

interface StaffBase {
  staffId: string;
  fullName: string;
  phone: string;
  telegramId: string;
  status: "Active" | "Inactive";
  primaryDepartment: Department | null;
  role: WebRole | null;
  fallbackDepartmentAccess: Department[];
  clinicalWriteScope: string;
  financialAccess: string;
}

function parseStaff(rows: string[][]): StaffBase[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const staffIdIdx = headerIndex(headers, "Staff_ID");
  const nameIdx = headerIndex(headers, "Full_Name");
  const phoneIdx = headerIndex(headers, "Phone");
  const telegramIdx = headerIndex(headers, "Telegram_ID");
  const roleIdx = headerIndex(headers, "Role");
  const statusIdx = headerIndex(headers, "Status");
  const primaryDepartmentIdx = headerIndex(headers, "Primary_Department");
  const departmentAccessIdx = headerIndex(headers, "Department_Access");
  const clinicalIdx = headerIndex(headers, "Clinical_Write_Scope");
  const financialIdx = headerIndex(headers, "Financial_Access");

  return rows.slice(1).flatMap((row) => {
    const staffId = at(row, staffIdIdx);
    if (!staffId) return [];
    const access = parseDepartment(at(row, departmentAccessIdx));
    return [
      {
        staffId,
        fullName: at(row, nameIdx),
        phone: normalizePhone(at(row, phoneIdx)),
        telegramId: at(row, telegramIdx),
        status:
          at(row, statusIdx).toLowerCase() === "inactive" ? "Inactive" : "Active",
        primaryDepartment: parseDepartment(at(row, primaryDepartmentIdx)),
        role: parseRole(at(row, roleIdx)),
        fallbackDepartmentAccess: access ? [access] : [],
        clinicalWriteScope: at(row, clinicalIdx),
        financialAccess: at(row, financialIdx),
      },
    ];
  });
}

interface DepartmentAccessRow {
  staffId: string;
  department: Department;
  status: string;
}

function parseDepartmentAccess(rows: string[][]): DepartmentAccessRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const staffIdIdx = headerIndex(headers, "Staff_ID");
  const departmentIdx = headerIndex(headers, "Department");
  const statusIdx = headerIndex(headers, "Status");

  return rows.slice(1).flatMap((row) => {
    const staffId = at(row, staffIdIdx);
    const department = parseDepartment(at(row, departmentIdx));
    const status = at(row, statusIdx) || "Active";
    if (!staffId || !department || status.toLowerCase() !== "active") return [];
    return [{ staffId, department, status }];
  });
}

async function readDepartmentAccessRows(): Promise<string[][]> {
  try {
    const snapshot = await fetchSheetRanges("physio", ["Staff_Department_Access"]);
    return snapshot["Staff_Department_Access"] || [];
  } catch (error) {
    // Transitional fallback only. Once all environments have the mapping tab,
    // missing mapping must become a hard failure before staff web login is enabled.
    console.warn("Staff_Department_Access unavailable; using 08_Staff fallback", error);
    return [];
  }
}

export async function getWebStaffDirectory(): Promise<WebStaffIdentity[]> {
  const [staffSnapshot, accessRows] = await Promise.all([
    fetchSheetRanges("physio", ["08_Staff"]),
    readDepartmentAccessRows(),
  ]);

  const staff = parseStaff(staffSnapshot["08_Staff"] || []);
  const mapping = parseDepartmentAccess(accessRows);
  const departmentsByStaff = new Map<string, Department[]>();
  for (const row of mapping) {
    const existing = departmentsByStaff.get(row.staffId) || [];
    if (!existing.includes(row.department)) existing.push(row.department);
    departmentsByStaff.set(row.staffId, existing);
  }

  return staff.map((item) => {
    const mappedDepartments = departmentsByStaff.get(item.staffId);
    return {
      staffId: item.staffId,
      fullName: item.fullName,
      phone: item.phone,
      telegramId: item.telegramId,
      status: item.status,
      primaryDepartment: item.primaryDepartment,
      roles: item.role ? [item.role] : [],
      departmentAccess:
        mappedDepartments && mappedDepartments.length > 0
          ? mappedDepartments
          : item.fallbackDepartmentAccess,
      clinicalWriteScope: item.clinicalWriteScope,
      financialAccess: item.financialAccess,
    };
  });
}

export async function getActiveWebStaffById(
  staffId: string
): Promise<WebStaffIdentity | null> {
  const directory = await getWebStaffDirectory();
  return (
    directory.find(
      (item) => item.staffId === staffId.trim() && item.status === "Active"
    ) || null
  );
}

export async function findActiveWebStaffByPhone(
  phone: string
): Promise<WebStaffIdentity | null> {
  const needle = normalizePhone(phone);
  if (!needle) return null;
  const directory = await getWebStaffDirectory();
  return (
    directory.find(
      (item) => item.status === "Active" && item.phone && item.phone === needle
    ) || null
  );
}

export function toAccessContext(identity: WebStaffIdentity): AccessContext | null {
  if (
    identity.status !== "Active" ||
    !identity.staffId ||
    !identity.primaryDepartment ||
    identity.roles.length === 0 ||
    identity.departmentAccess.length === 0
  ) {
    return null;
  }
  return {
    staffId: identity.staffId,
    roles: identity.roles,
    primaryDepartment: identity.primaryDepartment,
    departmentAccess: identity.departmentAccess,
    clinicalWriteScope: identity.clinicalWriteScope,
    financialAccess: identity.financialAccess,
  };
}
