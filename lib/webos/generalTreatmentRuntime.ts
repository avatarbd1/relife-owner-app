import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges, updateSheetValues } from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import { replaceEntityRowWithAudit, type SheetCellValue } from "@/lib/webos/sheetTransaction";
import { todayDhaka } from "@/lib/webos/reception";

const SESSION_SHEET = "23_Chamber_Sessions";
const APPOINTMENT_SHEET = "04_Appointments";
const GENERAL_BEDS = ["BED-1", "BED-2", "BED-3", "BED-4"] as const;

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], ...names: string[]): number {
  const source = headers.map(normalized);
  for (const name of names) {
    const index = source.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function columnLetter(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function roomForBed(bedId: string): string {
  if (bedId === "BED-1" || bedId === "BED-2") return "Room 1";
  if (bedId === "BED-3" || bedId === "BED-4") return "Room 2";
  return "";
}

function nowDhaka(ref = new Date()): { display: string; iso: string } {
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
    display: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`,
    iso: ref.toISOString(),
  };
}

function setCell(row: string[], headers: string[], name: string, value: string | number): void {
  const index = headerIndex(headers, name);
  if (index < 0) throw new Error("CHAMBER_SCHEMA_MISSING");
  while (row.length <= index) row.push("");
  row[index] = String(value);
}

async function assertAssignment(context: AccessContext, therapist: string): Promise<void> {
  if (context.roles.includes("Owner") || context.roles.includes("Manager")) return;
  if (!context.roles.includes("Therapist")) throw new Error("ACCESS_DENIED");
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");

  const assigned = normalized(therapist);
  // Therapist is optional at booking. Any authorised Physio therapist may pick up
  // an unassigned patient at actual treatment start.
  if (!assigned) return;
  if ([identity.staffId, identity.fullName].map(normalized).includes(assigned)) return;

  // Respect the existing clinical scope used by Relife for same-day cross-cover.
  const scope = normalized(identity.clinicalWriteScope).replace(/\s/g, "_");
  if (scope.includes("today_cross_cover") || scope.includes("cross_cover")) return;
  throw new Error("THERAPIST_NOT_ASSIGNED");
}

function auditRow(
  context: AccessContext,
  sessionId: string,
  patientId: string,
  bedId: string,
  now: ReturnType<typeof nowDhaka>
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.display,
    context.staffId,
    "chamber.start",
    "ChamberSession",
    sessionId,
    patientId,
    "",
    JSON.stringify({ stationId: bedId, allocatedAtActualStart: true }),
    "General bed allocated at actual treatment start",
    "RELIFE",
    "RELIFE-PHYSIO",
    "AMTALI-01",
    `RELIFE-PHYSIO:${sessionId}`,
    "",
    context.staffId,
    "web_pwa",
    "human_entry",
    false,
    true,
    "relife-uda-v1",
    now.iso,
    "Physio",
  ];
}

async function updateAppointmentStatus(appointmentId: string, status: string): Promise<void> {
  const snapshot = await fetchSheetRanges("physio", [APPOINTMENT_SHEET]);
  const rows = snapshot[APPOINTMENT_SHEET] || [];
  if (rows.length < 2) return;
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const statusIdx = headerIndex(headers, "Status");
  if (idIdx < 0 || statusIdx < 0) return;
  const offset = rows.slice(1).findIndex((row) => at(row, idIdx) === appointmentId);
  if (offset < 0) return;
  await updateSheetValues(
    "physio",
    `'${APPOINTMENT_SHEET}'!${columnLetter(statusIdx)}${offset + 2}`,
    [[status]]
  );
}

export async function startGeneralTreatment(
  context: AccessContext,
  sessionIdInput: string
): Promise<{ sessionId: string; stationId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const sessionId = normalize(sessionIdInput);
  const snapshot = await fetchSheetRanges("physio", [SESSION_SHEET]);
  const rows = snapshot[SESSION_SHEET] || [];
  if (rows.length < 2) throw new Error("CHAMBER_SCHEMA_MISSING");
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  const offset = rows.slice(1).findIndex((row) => at(row, idx("Session_ID")) === sessionId);
  if (offset < 0) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  const raw = rows[offset + 1];
  const status = at(raw, idx("Status"));
  if (normalized(status) === "in treatment") {
    const existing = at(raw, idx("Station_ID"));
    if (GENERAL_BEDS.includes(existing as (typeof GENERAL_BEDS)[number])) return { sessionId, stationId: existing };
  }
  if (normalized(status) !== "waiting") throw new Error("CHAMBER_SESSION_NOT_WAITING");
  if (at(raw, idx("Current_Resource_ID"))) throw new Error("MACHINE_STILL_RUNNING");
  const gender = parseGender(at(raw, idx("Gender")));
  if (!gender) throw new Error("PATIENT_GENDER_REQUIRED");
  await assertAssignment(context, at(raw, idx("Therapist")));

  const today = todayDhaka();
  const activeRows = rows.slice(1).filter(
    (row) => at(row, idx("Date")) === today && normalized(at(row, idx("Status"))) === "in treatment"
  );
  const occupied = new Set(activeRows.map((row) => at(row, idx("Station_ID"))).filter(Boolean));
  const roomGenders = new Map<string, Set<"Male" | "Female">>([
    ["Room 1", new Set<"Male" | "Female">()],
    ["Room 2", new Set<"Male" | "Female">()],
  ]);
  for (const row of activeRows) {
    const bedId = at(row, idx("Station_ID"));
    const roomId = roomForBed(bedId);
    const rowGender = parseGender(at(row, idx("Gender")));
    if (roomId && rowGender) roomGenders.get(roomId)?.add(rowGender);
  }

  const preferredRooms = [
    ...["Room 1", "Room 2"].filter((room) => {
      const genders = roomGenders.get(room) || new Set();
      return genders.size === 1 && genders.has(gender);
    }),
    ...["Room 1", "Room 2"].filter((room) => (roomGenders.get(room)?.size || 0) === 0),
  ];
  let stationId = "";
  for (const room of preferredRooms) {
    const beds = GENERAL_BEDS.filter((bed) => roomForBed(bed) === room);
    const free = beds.find((bed) => !occupied.has(bed));
    if (free) {
      stationId = free;
      break;
    }
  }
  if (!stationId) throw new Error("CHAMBER_CAPACITY:No gender-compatible general bed available");

  const now = nowDhaka();
  const next = [...raw];
  setCell(next, headers, "Room_ID", roomForBed(stationId));
  setCell(next, headers, "Station_ID", stationId);
  setCell(next, headers, "Status", "In Treatment");
  if (!at(raw, idx("Started_At"))) setCell(next, headers, "Started_At", now.iso);
  setCell(next, headers, "Current_Step", "Treatment started");
  setCell(next, headers, "Current_Resource_ID", "");
  setCell(next, headers, "Step_Started_At", "");
  setCell(next, headers, "Step_Duration_Min", 0);
  setCell(next, headers, "Expected_Release_At", "");
  setCell(next, headers, "Updated_At", now.iso);
  setCell(next, headers, "Updated_By", context.staffId);
  setCell(next, headers, "Version", Number(at(raw, idx("Version")) || 1) + 1);

  await replaceEntityRowWithAudit(
    "physio",
    SESSION_SHEET,
    offset + 2,
    next,
    auditRow(context, sessionId, at(raw, idx("Patient_ID")), stationId, now)
  );
  try {
    await updateAppointmentStatus(at(raw, idx("Appointment_ID")), "In Treatment");
  } catch (error) {
    console.error("General treatment started but appointment status sync failed", error);
  }
  return { sessionId, stationId };
}
