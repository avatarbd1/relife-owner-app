import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import {
  chamberDbMode,
  chamberSupabaseConfigured,
  syncSupabaseChamberCache,
} from "@/lib/data/supabaseChamber";
import type { PatientRecord } from "@/lib/patients";

const PLAN_SHEET = "12_Treatment_Plans";
const SYNC_TTL_MS = 60_000;

let syncState: { at: number; promise: Promise<void> } | null = null;

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase();
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

function parseActivePlans(rows: string[][]): Array<{
  patientId: string;
  electrotherapyPlan: string;
  manualTherapyPlan: string;
  exercisePlan: string;
  status: string;
}> {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const patientIdx = headerIndex(headers, "Patient_ID");
  const electroIdx = headerIndex(headers, "Electrotherapy_Plan");
  const manualIdx = headerIndex(headers, "Manual_Therapy_Plan");
  const exerciseIdx = headerIndex(headers, "Exercise_Plan");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  const latest = new Map<string, {
    patientId: string;
    electrotherapyPlan: string;
    manualTherapyPlan: string;
    exercisePlan: string;
    status: string;
  }>();

  for (const row of rows.slice(1)) {
    const patientId = at(row, patientIdx);
    if (!patientId) continue;
    const status = at(row, statusIdx) || "Active";
    if (normalized(status) !== "active") continue;
    const department = at(row, departmentIdx);
    if (department && normalized(department) !== "physio") continue;
    latest.set(patientId, {
      patientId,
      electrotherapyPlan: at(row, electroIdx),
      manualTherapyPlan: at(row, manualIdx),
      exercisePlan: at(row, exerciseIdx),
      status,
    });
  }
  return [...latest.values()];
}

async function runSync(patients: PatientRecord[]): Promise<void> {
  const planSnapshot = await fetchSheetRanges("physio", [PLAN_SHEET]);
  const physioPatients = patients
    .filter((patient) => patient.department === "Physio")
    .map((patient) => ({
      patientId: patient.patientId,
      fullName: patient.fullName,
      gender: patient.gender,
      therapist: patient.therapist,
      status: patient.status,
      department: "Physio",
    }));
  const plans = parseActivePlans(planSnapshot[PLAN_SHEET] || []);
  await syncSupabaseChamberCache({ patients: physioPatients, plans });
}

export async function syncChamberReferenceData(patients: PatientRecord[]): Promise<void> {
  if (chamberDbMode() === "sheets" || !chamberSupabaseConfigured()) return;
  const now = Date.now();
  if (syncState && now - syncState.at < SYNC_TTL_MS) {
    await syncState.promise;
    return;
  }
  const promise = runSync(patients).catch((error) => {
    console.error("Supabase Chamber reference sync failed", error);
    throw error;
  });
  syncState = { at: now, promise };
  try {
    await promise;
  } catch {
    syncState = null;
  }
}
