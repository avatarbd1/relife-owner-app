import type { TenantScope } from "./policy.ts";
import { requireTenantScope } from "./policy.ts";

/**
 * F2 — Import/Mapping Foundation
 *
 * Provides bounded, deterministic onboarding import validation.
 * Supports CSV with column mapping and full-dataset validation preview.
 * Tenant scoped and fail-closed. No mutation occurs in this layer.
 */

export type ImportEntityType = "patients" | "appointments" | "services" | "staff";

export interface ColumnMapping {
  sourceIndex: number;
  sourceHeader: string;
  targetField: string;
}

export interface ImportSession {
  organizationId: string;
  clinicId: string;
  entityType: ImportEntityType;
  sessionId: string;
  uploadedAt: Date;
  rowCount: number;
  mappings: ColumnMapping[];
  status: "mapping" | "preview" | "ready" | "completed" | "failed";
  validationErrors: string[];
}

export interface ImportPreviewRow {
  rowNumber: number;
  originalValues: Record<string, string>;
  mappedValues: Record<string, unknown>;
  validationIssues: string[];
  willImport: boolean;
}

export interface ImportValidationResult {
  sessionId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  preview: ImportPreviewRow[];
  canProceed: boolean;
  errors: string[];
}

const ALLOWED_TARGET_FIELDS: Record<ImportEntityType, Set<string>> = {
  patients: new Set(["name", "phone", "email", "gender", "age", "address", "department"]),
  appointments: new Set(["patientId", "date", "time", "therapist", "remarks", "department"]),
  services: new Set(["name", "price", "serviceCode", "department", "durationMin"]),
  staff: new Set(["name", "role", "staffId", "email", "department"]),
};

export function validateColumnMappings(entityType: ImportEntityType, mappings: ColumnMapping[], headers: string[]): string[] {
  const issues: string[] = [];
  const headerSet = new Set(headers);
  const targets = new Set<string>();
  for (const mapping of mappings) {
    if (!headerSet.has(mapping.sourceHeader)) issues.push(`unknown source header: ${mapping.sourceHeader}`);
    if (!ALLOWED_TARGET_FIELDS[entityType].has(mapping.targetField)) issues.push(`unsupported target field: ${mapping.targetField}`);
    if (targets.has(mapping.targetField)) issues.push(`duplicate target mapping: ${mapping.targetField}`);
    targets.add(mapping.targetField);
  }
  return [...new Set(issues)];
}

function isValidPhoneNumber(value: unknown): boolean {
  const phone = String(value || "").trim();
  return /^[\d\s\-+()]+$/.test(phone) && phone.length >= 10;
}

function isValidEmail(value: unknown): boolean {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(value: unknown): boolean {
  const str = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const date = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === str;
}

function isValidTime(value: unknown): boolean {
  const str = String(value || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(str)) return false;
  return true;
}

function isValidPrice(value: unknown): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0;
}

function normalizeDepartment(value: unknown): "Physio" | "Dental" | null {
  const department = String(value || "").trim().toLowerCase();
  if (department === "physio") return "Physio";
  if (department === "dental") return "Dental";
  return null;
}

function normalizeGender(value: unknown): "Male" | "Female" | "" | null {
  const gender = String(value || "").trim().toLowerCase();
  if (!gender) return "";
  if (gender === "male" || gender === "m") return "Male";
  if (gender === "female" || gender === "f") return "Female";
  return null;
}

export function validatePatientRow(row: Record<string, string>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const name = (row.name || "").trim();
  const phone = (row.phone || "").trim();
  const department = normalizeDepartment(row.department);
  const gender = normalizeGender(row.gender);
  if (!name) issues.push("name required");
  if (!department) issues.push("department must be Physio or Dental");
  if (phone && !isValidPhoneNumber(phone)) issues.push("invalid phone format");
  if (row.email && !isValidEmail(row.email)) issues.push("invalid email format");
  if (gender === null) issues.push("gender must be Male or Female when provided");
  if (department === "Physio" && gender !== "Male" && gender !== "Female") issues.push("Physio gender must be Male or Female");
  return { valid: issues.length === 0, issues };
}

export function validateAppointmentRow(row: Record<string, string>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const patientId = (row.patientId || "").trim();
  const date = (row.date || "").trim();
  const time = (row.time || "").trim();
  if (!patientId) issues.push("patientId required");
  if (!date) issues.push("date required");
  else if (!isValidDate(date)) issues.push("invalid date format (YYYY-MM-DD)");
  if (!time) issues.push("time required");
  else if (!isValidTime(time)) issues.push("invalid time format (HH:MM)");
  return { valid: issues.length === 0, issues };
}

export function validateServiceRow(row: Record<string, string>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const name = (row.name || "").trim();
  const price = row.price || "";
  if (!name) issues.push("name required");
  if (!price) issues.push("price required");
  else if (!isValidPrice(price)) issues.push("invalid price (must be non-negative number)");
  return { valid: issues.length === 0, issues };
}

export function validateStaffRow(row: Record<string, string>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const name = (row.name || "").trim();
  const role = (row.role || "").trim();
  if (!name) issues.push("name required");
  if (!role) issues.push("role required");
  if (row.email && !isValidEmail(row.email)) issues.push("invalid email format");
  return { valid: issues.length === 0, issues };
}

export function validateImportRow(entityType: ImportEntityType, row: Record<string, string>) {
  switch (entityType) {
    case "patients": return validatePatientRow(row);
    case "appointments": return validateAppointmentRow(row);
    case "services": return validateServiceRow(row);
    case "staff": return validateStaffRow(row);
  }
}

export function validateImportSession(scope: Partial<TenantScope>, session: ImportSession): string[] {
  const errors: string[] = [];
  const tenant = requireTenantScope(scope);
  if (session.organizationId !== tenant.organizationId || session.clinicId !== tenant.clinicId) errors.push("TENANT_SCOPE_MISMATCH");
  if (!session.mappings || session.mappings.length === 0) errors.push("column mapping not configured");
  if (session.validationErrors && session.validationErrors.length > 0) errors.push(`${session.validationErrors.length} validation errors present`);
  return errors;
}

export function analyzeImportRows(
  entityType: ImportEntityType,
  rows: Record<string, string>[],
  mappings: ColumnMapping[],
  maxPreviewRows = 10,
): { totalRows: number; validRows: number; invalidRows: number; canProceed: boolean; preview: ImportPreviewRow[] } {
  let validRows = 0;
  let invalidRows = 0;
  const preview: ImportPreviewRow[] = [];
  rows.forEach((originalRow, index) => {
    const mappedValues: Record<string, unknown> = {};
    for (const mapping of mappings) mappedValues[mapping.targetField] = originalRow[mapping.sourceHeader] || "";
    const validation = validateImportRow(entityType, mappedValues as Record<string, string>);
    if (validation.valid) validRows += 1; else invalidRows += 1;
    if (index < maxPreviewRows) {
      preview.push({ rowNumber: index + 2, originalValues: originalRow, mappedValues, validationIssues: validation.issues, willImport: validation.valid });
    }
  });
  return { totalRows: rows.length, validRows, invalidRows, canProceed: rows.length > 0 && invalidRows === 0, preview };
}

export function buildImportPreview(
  entityType: ImportEntityType,
  rows: Record<string, string>[],
  mappings: ColumnMapping[],
  maxPreviewRows = 5,
): ImportPreviewRow[] {
  return analyzeImportRows(entityType, rows, mappings, maxPreviewRows).preview;
}
