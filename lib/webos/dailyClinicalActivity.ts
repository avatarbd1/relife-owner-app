import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import type { Scope } from "@/lib/types";

type Department = "Physio" | "Dental";

export interface DailyClinicalActivity {
  patients: number;
  sessions: number;
  physioSessions: number;
  dentalSessions: number;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalized);
  for (const name of names) {
    const index = values.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function scopeAllows(scope: Scope, department: Department): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function dentalStatus(row: string[], headers: string[]): string {
  const statusIdx = headerIndex(headers, "Treatment_Status", "Status");
  const direct = at(row, statusIdx);
  if (direct) return normalized(direct);
  const remarks = at(row, headerIndex(headers, "Remarks"));
  const match = /(?:^|\|)\s*Status:\s*([^|]+)/i.exec(remarks);
  return normalized(match?.[1] || "");
}

function activityRows(
  rows: string[][],
  fallbackDepartment: Department,
  date: string,
  scope: Scope
): Array<{ department: Department; patientKey: string; sessionKey: string }> {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  return rows.slice(1).flatMap((row) => {
    const treatmentId = at(row, idx("Treatment_ID"));
    const patientId = at(row, idx("Patient_ID"));
    if (!treatmentId || !patientId || at(row, idx("Date")).slice(0, 10) !== date) return [];

    const department: Department =
      normalized(at(row, idx("Department"))) === "dental"
        ? "Dental"
        : fallbackDepartment;
    if (!scopeAllows(scope, department)) return [];

    // A planned Dental note is not delivered care. Ongoing/completed/follow-up
    // entries represent clinical work already started or delivered.
    if (department === "Dental" && dentalStatus(row, headers) === "planned") return [];

    const sessionNo = at(row, idx("Session_No"));
    const encounterId = at(row, idx("Encounter_ID"));
    const remarks = at(row, idx("Remarks"));
    const chamberMatch = /\[CHAMBER_SESSION:([^\]]+)\]/i.exec(remarks);

    // Legacy Physio data sometimes contains duplicate treatment rows for the
    // same patient/session number. Prefer patient+session number when present.
    // New Chamber completion is additionally idempotent by chamber session.
    const sessionKey =
      department === "Physio" && sessionNo
        ? `${department}:${patientId}:session:${sessionNo}`
        : chamberMatch?.[1]
          ? `${department}:chamber:${chamberMatch[1]}`
          : encounterId
            ? `${department}:encounter:${encounterId}`
            : `${department}:treatment:${treatmentId}`;

    return [
      {
        department,
        patientKey: `${department}:${patientId}`,
        sessionKey,
      },
    ];
  });
}

export function calculateDailyClinicalActivity(
  physioRows: string[][],
  dentalRows: string[][],
  scope: Scope,
  date: string
): DailyClinicalActivity {
  const rows = [
    ...activityRows(physioRows, "Physio", date, scope),
    ...activityRows(dentalRows, "Dental", date, scope),
  ];
  const uniqueSessions = new Map(rows.map((row) => [row.sessionKey, row]));
  const sessions = [...uniqueSessions.values()];
  return {
    patients: new Set(sessions.map((row) => row.patientKey)).size,
    sessions: sessions.length,
    physioSessions: sessions.filter((row) => row.department === "Physio").length,
    dentalSessions: sessions.filter((row) => row.department === "Dental").length,
  };
}

export async function getDailyClinicalActivity(
  scope: Scope,
  date: string
): Promise<DailyClinicalActivity> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");

  const needPhysio = scope === "combined" || scope === "physio";
  const needDental = scope === "combined" || scope === "dental";
  const [physio, dental] = await Promise.all([
    needPhysio
      ? fetchSheetRanges("physio", ["05_Treatments"])
      : Promise.resolve({} as Record<string, string[][]>),
    needDental
      ? fetchSheetRanges("dental", ["05_Treatments"])
      : Promise.resolve({} as Record<string, string[][]>),
  ]);

  return calculateDailyClinicalActivity(
    physio["05_Treatments"] || [],
    dental["05_Treatments"] || [],
    scope,
    date
  );
}
