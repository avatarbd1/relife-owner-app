import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  getSupabaseChamberBootstrap,
  setSupabaseLiveBedPreference,
  updateSupabaseLiveTherapist,
} from "@/lib/data/supabaseChamber";
import { fetchSheetRanges, updateSheetValues } from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { assignChamberTherapist } from "@/lib/webos/chamberAssignment";
import { setChamberBedPreference } from "@/lib/webos/chamberPreference";
import { todayDhaka } from "@/lib/webos/reception";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

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

function columnLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function exactCutover(): boolean {
  return chamberDbMode() === "supabase";
}

function requireCutoverConfig(): void {
  if (exactCutover() && !chamberSupabaseConfigured()) {
    throw new Error("SUPABASE_EDGE_SECRET_MISSING");
  }
}

async function supabaseAppointmentIdsToday(): Promise<Set<string>> {
  requireCutoverConfig();
  if (!exactCutover()) return new Set();
  const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
  return new Set(
    bootstrap.appointments
      .map((row) => normalize(row.id))
      .filter(Boolean)
  );
}

async function updateActiveSessionField(
  appointmentId: string,
  field: "Therapist" | "Recommended_Bed",
  value: string,
  requireWaiting = false
): Promise<void> {
  const snapshot = await fetchSheetRanges("physio", ["23_Chamber_Sessions"]);
  const rows = snapshot["23_Chamber_Sessions"] || [];
  if (rows.length < 2) {
    if (requireWaiting) throw new Error("CHAMBER_SESSION_NOT_WAITING");
    return;
  }
  const headers = rows[0];
  const appointmentIdx = headerIndex(headers, "Appointment_ID");
  const statusIdx = headerIndex(headers, "Status");
  const fieldIdx = headerIndex(headers, field);
  if (appointmentIdx < 0 || statusIdx < 0 || fieldIdx < 0) {
    throw new Error("CHAMBER_SCHEMA_MISSING");
  }

  const offset = rows.slice(1).findIndex((row) => {
    if (at(row, appointmentIdx) !== appointmentId) return false;
    const status = normalized(at(row, statusIdx));
    return requireWaiting
      ? status === "waiting"
      : status === "waiting" || status === "in treatment";
  });
  if (offset < 0) {
    if (requireWaiting) throw new Error("CHAMBER_SESSION_NOT_WAITING");
    return;
  }

  await updateSheetValues(
    "physio",
    `'23_Chamber_Sessions'!${columnLetter(fieldIdx)}${offset + 2}`,
    [[value]]
  );
}

/**
 * Legacy Sheet appointments keep the proven Sheet writer. Supabase-only
 * appointments update the tenant appointment first, then mirror any active
 * compatibility session field. Repeating the action is safe because the DB
 * control action is idempotent when the target value is already current.
 */
export async function assignUnifiedChamberTherapist(
  context: AccessContext,
  appointmentIdInput: string,
  staffIdInput: string
): Promise<{ appointmentId: string; therapist: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const appointmentId = normalize(appointmentIdInput);
  const staffId = normalize(staffIdInput);
  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!staffId) throw new Error("STAFF_NOT_FOUND");

  const directory = await getWebStaffDirectory();
  const therapist = directory.find(
    (staff) =>
      staff.staffId === staffId &&
      staff.status === "Active" &&
      staff.roles.includes("Therapist") &&
      (staff.departmentAccess.includes("Physio") || staff.departmentAccess.includes("All"))
  );
  if (!therapist) throw new Error("STAFF_NOT_FOUND");

  const supabaseIds = await supabaseAppointmentIdsToday();
  if (!supabaseIds.has(appointmentId)) {
    return assignChamberTherapist(context, appointmentId, staffId);
  }

  const result = await updateSupabaseLiveTherapist({
    appointmentId,
    therapist: therapist.fullName,
    actorId: context.staffId,
  });
  await updateActiveSessionField(appointmentId, "Therapist", therapist.fullName);
  return result;
}

/**
 * Supabase-only pre-start bed preference keeps the existing Live Chamber
 * waiting/station/gender checks, then the database re-checks overlapping tenant
 * appointments before changing appointment/timeline/reservation bed identity.
 * The waiting Sheet session mirrors Recommended_Bed so the current start engine
 * consumes the same preference.
 */
export async function setUnifiedChamberBedPreference(
  context: AccessContext,
  appointmentIdInput: string,
  stationIdInput: string
): Promise<{ appointmentId: string; stationId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const appointmentId = normalize(appointmentIdInput);
  const stationId = normalize(stationIdInput);
  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!stationId) throw new Error("STATION_NOT_FOUND");

  const supabaseIds = await supabaseAppointmentIdsToday();
  if (!supabaseIds.has(appointmentId)) {
    return setChamberBedPreference(context, appointmentId, stationId);
  }

  const chamber = await getChamberSnapshot(context);
  const queueItem = chamber.queue.find((item) => item.appointmentId === appointmentId);
  if (!queueItem) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!queueItem.sessionId || queueItem.sessionStatus !== "Waiting") {
    throw new Error("CHAMBER_SESSION_NOT_WAITING");
  }

  const stationView = chamber.stations.find(
    (item) => item.resource.resourceId === stationId
  );
  if (!stationView) throw new Error("STATION_NOT_FOUND");
  if (stationView.session && stationView.session.sessionId !== queueItem.sessionId) {
    throw new Error("CHAMBER_CAPACITY:STATION_BUSY");
  }

  const isTraction = stationId === "TRACTION-BED";
  if (!isTraction && !queueItem.gender) throw new Error("PATIENT_GENDER_REQUIRED");
  if (
    !isTraction &&
    stationView.roomGender &&
    stationView.roomGender !== queueItem.gender
  ) {
    throw new Error(`CHAMBER_CAPACITY:ROOM_GENDER:${stationView.roomGender}`);
  }

  const result = await setSupabaseLiveBedPreference({
    appointmentId,
    stationId,
    actorId: context.staffId,
  });
  await updateActiveSessionField(
    appointmentId,
    "Recommended_Bed",
    stationId,
    true
  );
  return result;
}
