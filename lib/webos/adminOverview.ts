import "server-only";

import { fetchSheetRanges, type Workbook } from "@/lib/data/googleSheets";
import type { Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";

type ClinicDepartment = "Physio" | "Dental";
export type AuditCategory = "Login" | "Patient" | "Finance" | "Access" | "System";
export type AuditSeverity = "success" | "info" | "warning" | "critical";

export interface AuditEventView {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  patientId: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
  department: ClinicDepartment;
  sourceSystem: string;
  category: AuditCategory;
  severity: AuditSeverity;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function lower(value: unknown): string {
  return normalize(value).toLowerCase();
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(lower);
  for (const name of names) {
    const index = values.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number, fallbackIndex?: number): string {
  if (index >= 0) return normalize(row[index]);
  if (typeof fallbackIndex === "number") return normalize(row[fallbackIndex]);
  return "";
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function classify(action: string, entityType: string): AuditCategory {
  const text = `${action} ${entityType}`.toLowerCase();
  if (/login|logout|session|auth|credential/.test(text)) return "Login";
  if (/passkey|staff|role|access|permission|device|enroll/.test(text)) return "Access";
  if (/payment|expense|cash|salary|finance|receipt|handover|treasury/.test(text)) return "Finance";
  if (/patient|clinical|appointment|treatment|assessment|report|session/.test(text)) return "Patient";
  return "System";
}

function severityFor(action: string, afterValue: string): AuditSeverity {
  const text = `${action} ${afterValue}`.toLowerCase();
  if (/failed|failure|error|unauthorized|denied|invalid|attack|lockout/.test(text)) return "critical";
  if (/reject|cancel|void|delete|reverse|mismatch|discrepancy/.test(text)) return "warning";
  if (/create|created|paid|approve|approved|accept|accepted|complete|completed|register|record|success/.test(text)) return "success";
  return "info";
}

function parseAuditRows(
  rows: string[][],
  department: ClinicDepartment
): AuditEventView[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Audit_ID", "Audit ID", "ID");
  const timestampIdx = headerIndex(headers, "Timestamp", "Date_Time", "Date Time");
  const actorIdx = headerIndex(headers, "User", "Actor", "Staff_ID", "Performed_By");
  const actionIdx = headerIndex(headers, "Action");
  const entityTypeIdx = headerIndex(headers, "Entity_Type", "Entity Type");
  const entityIdIdx = headerIndex(headers, "Entity_ID", "Entity ID");
  const patientIdIdx = headerIndex(headers, "Patient_ID", "Patient ID");
  const beforeIdx = headerIndex(headers, "Before_Value", "Before", "Old_Value");
  const afterIdx = headerIndex(headers, "After_Value", "After", "New_Value");
  const reasonIdx = headerIndex(headers, "Reason", "Note", "Remarks");
  const sourceIdx = headerIndex(headers, "Source_System", "Source System");
  const departmentIdx = headerIndex(headers, "Department");

  return rows.slice(1).flatMap((row, rowIndex) => {
    const action = at(row, actionIdx, 3);
    const entityType = at(row, entityTypeIdx, 4);
    const timestamp = at(row, timestampIdx, 1);
    if (!action && !timestamp) return [];
    const rowDepartment = at(row, departmentIdx, 22);
    const resolvedDepartment: ClinicDepartment =
      rowDepartment.toLowerCase() === "dental" ? "Dental" : department;
    const afterValue = at(row, afterIdx, 8);
    return [{
      id: at(row, idIdx, 0) || `${department}-${rowIndex + 2}`,
      timestamp,
      actor: at(row, actorIdx, 2) || "System",
      action: action || "Recorded action",
      entityType: entityType || "Record",
      entityId: at(row, entityIdIdx, 5),
      patientId: at(row, patientIdIdx, 6),
      beforeValue: at(row, beforeIdx, 7),
      afterValue,
      reason: at(row, reasonIdx, 9),
      department: resolvedDepartment,
      sourceSystem: at(row, sourceIdx, 16),
      category: classify(action, entityType),
      severity: severityFor(action, afterValue),
    }];
  });
}

async function auditForWorkbook(
  context: AccessContext,
  scope: Scope,
  workbook: Workbook,
  department: ClinicDepartment
): Promise<AuditEventView[]> {
  if (!scopeAllows(scope, department) || !canPerform(context, "audit.read", department)) return [];
  try {
    const snapshot = await fetchSheetRanges(workbook, ["20_Data_Audit"]);
    return parseAuditRows(snapshot["20_Data_Audit"] || [], department).filter(
      (event) => scopeAllows(scope, event.department) && canPerform(context, "audit.read", event.department)
    );
  } catch (error) {
    console.error(`${department} audit load failed`, error);
    return [];
  }
}

export async function getAuditOverview(
  context: AccessContext,
  scope: Scope
): Promise<{ events: AuditEventView[]; critical: AuditEventView[] }> {
  const [physio, dental] = await Promise.all([
    auditForWorkbook(context, scope, "physio", "Physio"),
    auditForWorkbook(context, scope, "dental", "Dental"),
  ]);
  const events = [...physio, ...dental]
    .sort((a, b) => `${b.timestamp}|${b.id}`.localeCompare(`${a.timestamp}|${a.id}`))
    .slice(0, 500);
  return {
    events,
    critical: events.filter((event) => event.severity === "critical").slice(0, 10),
  };
}
