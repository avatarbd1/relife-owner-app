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

    // Planned Dental work is not delivered care. Ongoing/completed/follow-up
    // records mean clinical work has already started or been delivered.
    if (department === "Dental" && dentalStatus(row, headers) === "planned") return [];

    const sessionNo = at(row, idx("Session_No"));
    const planId = at(row, idx("Plan_ID"));
    const encounterId = at(row, idx("Encounter_ID"));
    const remarks = at(row, idx("Remarks"));
    const chamberMatch = /\[CHAMBER_SESSION:([^\]]+)\]/i.exec(remarks);

    // Chamber completion is the strongest identity. For legacy Physio rows,
    // patient + plan + session number collapses duplicate entries for one
    // delivered session without merging different sessions.
    const sessionKey = chamberMatch?.[1]
      ? `${department}:chamber:${chamberMatch[1]}`
      : department === "Physio" && sessionNo
        ? `${department}:${patientId}:plan:${planId || "none"}:session:${sessionNo}`
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
