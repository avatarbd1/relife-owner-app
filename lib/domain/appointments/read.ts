import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  querySupabaseChamberAppointments,
  type SupabaseAppointmentRow,
} from "@/lib/data/supabaseChamber";
import type { PatientRecord } from "@/lib/patients";
import type { Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import {
  appointmentMinutes,
  getAppointmentsForContext,
  getPatientAppointmentsForContext,
  type AppointmentRecord,
} from "@/lib/webos/reception";

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function sheetTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(normalize(value));
  if (!match) return normalize(value);
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return normalize(value);
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function fromSupabase(row: SupabaseAppointmentRow): AppointmentRecord {
  return {
    appointmentId: normalize(row.id),
    date: normalize(row.date).slice(0, 10),
    time: sheetTime(row.start_time),
    patientId: normalize(row.patient_id),
    patientName: normalize(row.patient_name),
    department: "Physio",
    therapist: normalize(row.therapist),
    status: normalize(row.status) || "Scheduled",
    remarks: normalize(row.remarks),
    receivedBy: "",
    organizationId: "RELIFE",
    clinicId: "RELIFE-PHYSIO",
  };
}

function mergeAppointments(
  sheets: AppointmentRecord[],
  supabase: SupabaseAppointmentRow[]
): AppointmentRecord[] {
  const merged = new Map<string, AppointmentRecord>();
  for (const row of sheets) merged.set(`${row.department}:${row.appointmentId}`, row);
  for (const row of supabase) {
    const mapped = fromSupabase(row);
    if (mapped.appointmentId) merged.set(`Physio:${mapped.appointmentId}`, mapped);
  }
  return [...merged.values()];
}

function sortAscending(rows: AppointmentRecord[]): AppointmentRecord[] {
  return rows.sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    if (dateOrder !== 0) return dateOrder;
    return appointmentMinutes(a.time) - appointmentMinutes(b.time);
  });
}

function sortDescending(rows: AppointmentRecord[]): AppointmentRecord[] {
  return rows.sort((a, b) => {
    const dateOrder = b.date.localeCompare(a.date);
    if (dateOrder !== 0) return dateOrder;
    return appointmentMinutes(b.time) - appointmentMinutes(a.time);
  });
}

function needsSupabasePhysio(context: AccessContext, scope: Scope): boolean {
  return (
    chamberDbMode() === "supabase" &&
    scope !== "dental" &&
    canPerform(context, "appointment.read", "Physio")
  );
}

function requireConfiguredCutover(): void {
  if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");
}

/**
 * Transitional appointment read model used by the main appointments workspace.
 * Legacy Sheets rows remain visible; tenant-scoped Supabase Physio rows are
 * merged only after the explicit cutover mode is enabled.
 *
 * Supabase failures are deliberately not converted into a Sheets-only result in
 * cutover mode, because doing so could silently hide new Supabase-only bookings.
 */
export async function getUnifiedAppointmentsForContext(
  context: AccessContext,
  scope: Scope,
  startDate: string,
  endDate: string
): Promise<AppointmentRecord[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("INVALID_DATE");
  }
  const sheetRows = (await getAppointmentsForContext(context, scope)).filter(
    (row) => row.date >= startDate && row.date <= endDate
  );
  if (!needsSupabasePhysio(context, scope)) return sortAscending(sheetRows);
  requireConfiguredCutover();

  const supabaseRows = await querySupabaseChamberAppointments({ startDate, endDate });
  return sortAscending(mergeAppointments(sheetRows, supabaseRows));
}

/** Patient file history parity for Supabase-created Chamber appointments. */
export async function getUnifiedPatientAppointmentsForContext(
  context: AccessContext,
  patient: PatientRecord
): Promise<AppointmentRecord[]> {
  const sheetRows = await getPatientAppointmentsForContext(context, patient);
  if (
    patient.department !== "Physio" ||
    chamberDbMode() !== "supabase" ||
    !canPerform(context, "appointment.read", "Physio")
  ) {
    return sheetRows;
  }
  requireConfiguredCutover();

  const supabaseRows = await querySupabaseChamberAppointments({ patientId: patient.patientId });
  return sortDescending(mergeAppointments(sheetRows, supabaseRows));
}
