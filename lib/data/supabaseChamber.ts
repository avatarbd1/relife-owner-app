import "server-only";

import { randomUUID } from "node:crypto";
import { RELIFE_SUPABASE_SCOPE } from "@/lib/config/relifeSystem";

export type ChamberDbMode = "sheets" | "shadow" | "supabase";

export interface SupabasePatientCacheRow {
  patient_id: string;
  full_name: string;
  gender: string;
  therapist: string;
  status: string;
  department: string;
}

export interface SupabasePlanCacheRow {
  patient_id: string;
  electrotherapy_plan: string;
  manual_therapy_plan: string;
  exercise_plan: string;
  status: string;
}

export interface SupabaseResourceRow {
  resource_id: string;
  resource_name: string;
  resource_type: string;
  room_id: string;
  station_id: string;
  enabled: boolean;
  department: string;
  default_duration_min: number | null;
  notes: string;
}

export interface SupabaseAppointmentRow {
  id: string;
  date: string;
  start_time: string;
  patient_id: string;
  patient_name: string;
  gender: string;
  therapist: string;
  status: string;
  bed_id: string;
  modalities: string[];
  expected_duration_min: number;
  timeline_id: string;
  remarks: string;
}

export interface SupabaseReservationRow {
  id: string;
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  bed_id: string;
  resource_id: string;
  resource_name: string;
  sequence: number;
  start_minute: number;
  end_minute: number;
  duration_min: number;
  status: string;
}

export interface SupabaseTimelineRow {
  id: string;
  timeline_id: string;
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  bed_id: string;
  sequence: number;
  step_name: string;
  resource_id: string;
  resource_name: string;
  duration_min: number;
  start_minute: number;
  end_minute: number;
  status: string;
}

export interface SupabaseChamberBootstrap {
  ok: boolean;
  patients: SupabasePatientCacheRow[];
  plans: SupabasePlanCacheRow[];
  resources: SupabaseResourceRow[];
  appointments: SupabaseAppointmentRow[];
  reservations: SupabaseReservationRow[];
  timeline: SupabaseTimelineRow[];
  sessions: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  equipment: Array<Record<string, unknown>>;
}

export interface SupabaseValidatedBookingPlan {
  patientId: string;
  date: string;
  startMinute: number;
  therapist: string;
  bedId: string;
  gender: string;
  roomId: string;
  modalities: string[];
  totalDurationMin: number;
  timeline: Array<{
    sequence: number;
    name: string;
    resourceId: string;
    resourceName: string;
    durationMin: number;
    startMinute: number;
    endMinute: number;
  }>;
  remarks: string;
}

const DEFAULT_EDGE_URL = "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-chamber-api";

export function chamberDbMode(): ChamberDbMode {
  const value = String(process.env.RELIFE_CHAMBER_DB_MODE || "sheets").trim().toLowerCase();
  if (value === "shadow" || value === "supabase") return value;
  return "sheets";
}

export function chamberSupabaseConfigured(): boolean {
  return Boolean((process.env.RELIFE_SUPABASE_EDGE_URL || DEFAULT_EDGE_URL).trim() && process.env.RELIFE_EDGE_SECRET?.trim());
}

export function shouldUseSupabaseValidation(): boolean {
  return chamberDbMode() !== "sheets" && chamberSupabaseConfigured();
}

async function callEdge<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const url = (process.env.RELIFE_SUPABASE_EDGE_URL || DEFAULT_EDGE_URL).trim();
  const secret = process.env.RELIFE_EDGE_SECRET?.trim();
  if (!secret) throw new Error("SUPABASE_EDGE_SECRET_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-server-key": secret,
      },
      body: JSON.stringify({
        action,
        ...payload,
        organizationSlug: RELIFE_SUPABASE_SCOPE.organizationSlug,
        clinicSlug: RELIFE_SUPABASE_SCOPE.clinicSlug,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const detail = String(result?.detail || result?.error || `HTTP ${response.status}`);
      const error = new Error(detail);
      (error as Error & { status?: number; payload?: unknown }).status = response.status;
      (error as Error & { status?: number; payload?: unknown }).payload = result;
      throw error;
    }
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSupabaseChamberBootstrap(date: string): Promise<SupabaseChamberBootstrap> {
  return callEdge<SupabaseChamberBootstrap>("bootstrap", { date });
}

export async function querySupabaseChamberAppointments(input: {
  startDate?: string;
  endDate?: string;
  patientId?: string;
}): Promise<SupabaseAppointmentRow[]> {
  const result = await callEdge<{ ok: true; appointments: SupabaseAppointmentRow[] }>(
    "appointments_query",
    input
  );
  return result.appointments;
}

export async function updateSupabaseChamberAppointmentStatus(input: {
  appointmentId: string;
  status: string;
  actorId: string;
}): Promise<{ appointmentId: string; status: string }> {
  const result = await callEdge<{
    ok: true;
    appointmentId: string;
    status: string;
  }>("update_booking_status", input);
  return { appointmentId: result.appointmentId, status: result.status };
}

export async function validateSupabaseBookingPlan(
  plan: SupabaseValidatedBookingPlan
): Promise<Array<{ type: string; message: string }>> {
  const result = await callEdge<{
    ok: true;
    conflicts: Array<{ type: string; message: string }>;
  }>("validate_booking_plan", { plan });
  return Array.isArray(result.conflicts) ? result.conflicts : [];
}

export async function createSupabaseValidatedBooking(input: {
  plan: SupabaseValidatedBookingPlan;
  actorId: string;
  requestId: string;
}): Promise<{
  appointmentId: string;
  timelineId: string;
  duplicate?: boolean;
}> {
  const result = await callEdge<{
    ok: true;
    appointmentId: string;
    timelineId: string;
    duplicate?: boolean;
  }>("create_validated_booking", input);
  return {
    appointmentId: result.appointmentId,
    timelineId: result.timelineId,
    duplicate: result.duplicate,
  };
}

export async function syncSupabaseChamberCache(input: {
  patients: Array<{
    patientId: string;
    fullName: string;
    gender: string;
    therapist: string;
    status: string;
    department: string;
  }>;
  plans: Array<{
    patientId: string;
    electrotherapyPlan: string;
    manualTherapyPlan: string;
    exercisePlan: string;
    status: string;
  }>;
}): Promise<void> {
  await callEdge("sync_cache", input);
}

export async function createSupabaseFixedHourBooking(input: {
  patientId: string;
  date: string;
  startMinute: number;
  therapist: string;
  bedId: string;
  modalities: string[];
  timeline: Array<{
    name: string;
    resourceId: string;
    resourceName?: string;
    durationMin: number;
    startMinute: number;
    endMinute: number;
  }>;
  remarks: string;
  actorId: string;
  requestId?: string;
}): Promise<{ ok: true; appointmentId: string; timelineId: string; duplicate?: boolean }> {
  return callEdge("create_booking", {
    ...input,
    requestId: input.requestId || `CBK${randomUUID().replace(/-/g, "")}`,
  });
}
