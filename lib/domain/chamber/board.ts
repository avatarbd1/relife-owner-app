import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import {
  chamberDbMode,
  chamberSupabaseConfigured,
  getSupabaseChamberBootstrap,
  type SupabaseAppointmentRow,
} from "@/lib/data/supabaseChamber";
import {
  PHYSIO_CHAMBER_STARTS,
  chamberStartMinutes,
} from "@/lib/domain/chamber/hours";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

const APPOINTMENT_SHEET = "04_Appointments";
const TERMINAL_NON_OCCUPYING = new Set(["cancelled", "canceled", "no-show"]);

export type HourlyBedId =
  | "BED-1"
  | "BED-2"
  | "BED-3"
  | "BED-4"
  | "TRACTION-BED";

export interface HourlyBoardAppointment {
  appointmentId: string;
  date: string;
  time: string;
  startMinute: number;
  endMinute: number;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  assignedBedId: HourlyBedId | "";
  treatmentDurationMin: number;
  bedHoldDurationMin: number;
  modalities: string[];
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

function ensureHeaders(headers: string[], required: string[]): void {
  const present = new Set(headers.map(normalized));
  if (required.some((name) => !present.has(name.toLowerCase()))) {
    throw new Error("SCHEMA_MISMATCH");
  }
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : []
        )
      : [];
  } catch {
    return [];
  }
}

function timeMinutes(value: string): number {
  const text = normalize(value).toUpperCase();
  const input = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (input) {
    const hour = Number(input[1]);
    const minute = Number(input[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return hour * 60 + minute;
    }
  }
  const sheet = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (sheet) {
    let hour = Number(sheet[1]) % 12;
    const minute = Number(sheet[2]);
    if (sheet[3] === "PM") hour += 12;
    if (minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  throw new Error("INVALID_TIME");
}

function inputTime(value: number): string {
  const minute = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60
  ).padStart(2, "0")}`;
}

function shortHour(value: number): string {
  const hour24 = Math.floor(value / 60) % 24;
  return String(hour24 % 12 || 12);
}

function slotLabel(startMinute: number): string {
  return `${shortHour(startMinute)}–${shortHour(startMinute + 60)}`;
}

function bedId(value: unknown): HourlyBedId | "" {
  const text = normalized(value);
  if (["traction", "traction bed", "traction-bed"].includes(text)) {
    return "TRACTION-BED";
  }
  const match = /bed[-\s]*([1-4])/.exec(text);
  return match ? (`BED-${match[1]}` as HourlyBedId) : "";
}

function flowBedFromRemarks(remarks: string): HourlyBedId | "" {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return "";
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    if (!key || rest.length === 0) continue;
    if (["bed", "station"].includes(key.trim().toLowerCase())) {
      const parsed = bedId(rest.join("=").trim());
      if (parsed) return parsed;
    }
  }
  return "";
}

function parseBoardAppointments(
  rows: string[][],
  date: string
): HourlyBoardAppointment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);

  return rows
    .slice(1)
    .flatMap((row) => {
      const appointmentId = at(row, idx("Appointment_ID"));
      if (!appointmentId || at(row, idx("Date")) !== date) return [];
      const status = at(row, idx("Status")) || "Scheduled";
      if (TERMINAL_NON_OCCUPYING.has(normalized(status))) return [];

      let startMinute = 0;
      try {
        startMinute = timeMinutes(at(row, idx("Time")));
      } catch {
        return [];
      }

      const expected = Number(at(row, idx("Expected_Duration_Min")) || 0);
      const treatmentDurationMin =
        Number.isFinite(expected) && expected > 0 ? expected : 60;
      const bedHoldDurationMin = Math.max(60, treatmentDurationMin);
      const remarks = at(row, idx("Remarks"));
      const assignedBedId =
        bedId(at(row, idx("Assigned_Bed_ID"))) || flowBedFromRemarks(remarks);

      return [
        {
          appointmentId,
          date,
          time: at(row, idx("Time")),
          startMinute,
          endMinute: startMinute + bedHoldDurationMin,
          patientId: at(row, idx("Patient_ID")),
          patientName: at(row, idx("Patient_Name")),
          therapist: at(row, idx("Therapist")),
          status,
          assignedBedId,
          treatmentDurationMin,
          bedHoldDurationMin,
          modalities: parseJsonArray(at(row, idx("Modalities_JSON"))),
        },
      ];
    })
    .sort((a, b) => a.startMinute - b.startMinute);
}

function parseSupabaseAppointment(
  row: SupabaseAppointmentRow,
  date: string
): HourlyBoardAppointment | null {
  if (String(row.date).slice(0, 10) !== date) return null;
  const status = normalize(row.status) || "Scheduled";
  if (TERMINAL_NON_OCCUPYING.has(normalized(status))) return null;
  let startMinute = 0;
  try {
    startMinute = timeMinutes(row.start_time);
  } catch {
    return null;
  }
  const treatmentDurationMin = Math.max(60, Number(row.expected_duration_min || 60));
  return {
    appointmentId: normalize(row.id),
    date,
    time: inputTime(startMinute),
    startMinute,
    endMinute: startMinute + treatmentDurationMin,
    patientId: normalize(row.patient_id),
    patientName: normalize(row.patient_name),
    therapist: normalize(row.therapist),
    status,
    assignedBedId: bedId(row.bed_id),
    treatmentDurationMin,
    bedHoldDurationMin: treatmentDurationMin,
    modalities: Array.isArray(row.modalities) ? row.modalities.map(String) : [],
  };
}

async function loadAppointmentRows(): Promise<string[][]> {
  const snapshot = await fetchSheetRanges("physio", [APPOINTMENT_SHEET]);
  const rows = snapshot[APPOINTMENT_SHEET] || [];
  if (!rows.length) throw new Error("SCHEMA_MISMATCH");
  ensureHeaders(rows[0], [
    "Appointment_ID",
    "Date",
    "Time",
    "Patient_ID",
    "Therapist",
    "Status",
    "Remarks",
    "Assigned_Bed_ID",
    "Modalities_JSON",
    "Expected_Duration_Min",
  ]);
  return rows;
}

/**
 * Canonical read model for the Chamber hourly bed board.
 * During exact Supabase cutover, legacy Sheets rows and Supabase rows are merged.
 * Supabase wins on matching appointment IDs, and failures fail closed so a new
 * Supabase-only booking can never silently disappear from the board.
 */
export async function getHourlyBedBoard(
  context: AccessContext,
  date: string
): Promise<HourlyBoardAppointment[]> {
  assertCanPerform(context, "chamber.read", "Physio");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");

  const sheets = parseBoardAppointments(await loadAppointmentRows(), date);
  if (chamberDbMode() !== "supabase") return sheets;
  if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");

  const snapshot = await getSupabaseChamberBootstrap(date);
  const merged = new Map(sheets.map((item) => [item.appointmentId, item]));
  for (const row of snapshot.appointments) {
    const appointment = parseSupabaseAppointment(row, date);
    if (appointment?.appointmentId) merged.set(appointment.appointmentId, appointment);
  }
  return [...merged.values()].sort((a, b) => a.startMinute - b.startMinute);
}

export function chamberHourSlots(): Array<{
  startMinute: number;
  time: string;
  label: string;
}> {
  return PHYSIO_CHAMBER_STARTS.map((time) => {
    const startMinute = chamberStartMinutes(time);
    return {
      startMinute,
      time,
      label: slotLabel(startMinute),
    };
  });
}
