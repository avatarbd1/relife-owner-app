import "server-only";

import {
  chamberDbMode,
  chamberSupabaseConfigured,
  completeSupabaseChamberSession,
  getSupabaseChamberBootstrap,
  receiveSupabaseChamberSession,
  startSupabaseChamberSession,
  updateSupabaseChamberSessionStep,
  type SupabaseAppointmentRow,
  type SupabaseChamberBootstrap,
  type SupabaseResourceRow,
} from "@/lib/data/supabaseChamber";
import {
  completeChamberSession as completeSheetsChamberSession,
  getChamberSnapshot as getSheetsChamberSnapshot,
  receiveChamberPatient as receiveSheetsChamberPatient,
  startChamberSession as startSheetsChamberSession,
  updateChamberStep as updateSheetsChamberStep,
  type ChamberResource,
  type ChamberSession,
  type ChamberSnapshot,
} from "@/lib/webos/chamber";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import { todayDhaka } from "@/lib/webos/reception";
import { withMutationLock } from "@/lib/webos/mutationLock";

const ACTIVE_APPOINTMENTS = new Set(["scheduled", "received", "arrived", "waiting", "in treatment"]);
const ACTIVE_SESSIONS = new Set(["Waiting", "In Treatment"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function asStepLog(value: unknown): ChamberSession["stepLog"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const step = normalize(row.step);
    if (!step) return [];
    return [{
      step,
      resourceId: normalize(row.resourceId || row.resource_id),
      startedAt: normalize(row.startedAt || row.started_at),
      endedAt: normalize(row.endedAt || row.ended_at),
      plannedDurationMin: Number(row.plannedDurationMin || row.planned_duration_min || 0),
    }];
  });
}

function supabaseSession(row: Record<string, unknown>): ChamberSession {
  return {
    sessionId: normalize(row.id),
    date: normalize(row.date).slice(0, 10),
    appointmentId: normalize(row.appointment_id),
    patientId: normalize(row.patient_id),
    patientName: normalize(row.patient_name),
    gender: parseGender(row.gender),
    therapist: normalize(row.therapist),
    roomId: normalize(row.room_id),
    stationId: normalize(row.station_id),
    status: (["Waiting", "In Treatment", "Completed", "Cancelled"].includes(normalize(row.status))
      ? normalize(row.status)
      : "Waiting") as ChamberSession["status"],
    receivedAt: normalize(row.received_at),
    startedAt: normalize(row.started_at),
    currentStep: normalize(row.current_step),
    currentResourceId: normalize(row.current_resource_id),
    stepStartedAt: normalize(row.step_started_at),
    stepDurationMin: Number(row.step_duration_min || 0),
    expectedReleaseAt: normalize(row.expected_release_at),
    stepLog: asStepLog(row.step_log),
    completedAt: normalize(row.completed_at),
    updatedAt: normalize(row.updated_at),
    updatedBy: normalize(row.updated_by),
    version: Number(row.version || 1),
  };
}

function supabaseResource(row: SupabaseResourceRow): ChamberResource {
  return {
    resourceId: normalize(row.resource_id),
    resourceName: normalize(row.resource_name) || normalize(row.resource_id),
    resourceType: normalized(row.resource_type) === "station" ? "Station" : "Machine",
    roomId: normalize(row.room_id),
    stationId: normalize(row.station_id),
    enabled: Boolean(row.enabled),
    department: "Physio",
    notes: normalize(row.notes),
    defaultDurationMin: Number(row.default_duration_min || 0),
  };
}

function roomGender(roomId: string, sessions: ChamberSession[]): "Male" | "Female" | "Mixed" | "" {
  const genders = new Set(
    sessions
      .filter((session) => session.status === "In Treatment" && session.roomId === roomId && session.gender)
      .map((session) => session.gender)
  );
  if (genders.size === 0) return "";
  if (genders.size > 1) return "Mixed";
  return [...genders][0] as "Male" | "Female";
}

function requireCutoverConfigured(): void {
  if (!chamberSupabaseConfigured()) throw new Error("SUPABASE_EDGE_SECRET_MISSING");
}

async function assertRunAssignment(
  context: AccessContext,
  appointment: SupabaseAppointmentRow | undefined
): Promise<void> {
  if (context.roles.includes("Owner") || context.roles.includes("Manager")) return;
  if (!context.roles.includes("Therapist")) throw new Error("ACCESS_DENIED");
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");
  const assigned = normalized(appointment?.therapist);
  if (!assigned || ![identity.staffId, identity.fullName].map(normalized).includes(assigned)) {
    throw new Error("THERAPIST_NOT_ASSIGNED");
  }
}

function findSupabaseAppointment(
  bootstrap: SupabaseChamberBootstrap,
  appointmentId: string
): SupabaseAppointmentRow | undefined {
  return bootstrap.appointments.find((item) => normalize(item.id) === appointmentId);
}

function mergedSnapshot(
  sheets: ChamberSnapshot,
  bootstrap: SupabaseChamberBootstrap
): ChamberSnapshot {
  const supabaseSessions = bootstrap.sessions.map(supabaseSession);
  const sheetSessions = [
    ...sheets.stations.flatMap((station) => (station.session ? [station.session] : [])),
    ...sheets.queue.flatMap(() => [] as ChamberSession[]),
  ];
  const allRunning = [
    ...sheetSessions.filter((session) => session.status === "In Treatment"),
    ...supabaseSessions.filter((session) => session.status === "In Treatment"),
  ];

  const stations = sheets.stations.map((station) => ({ ...station }));
  const machines = sheets.machines.map((machine) => ({ ...machine }));
  const knownStationIds = new Set(stations.map((item) => item.resource.resourceId));
  const knownMachineIds = new Set(machines.map((item) => item.resource.resourceId));

  for (const row of bootstrap.resources.filter((item) => item.enabled)) {
    const resource = supabaseResource(row);
    if (resource.resourceType === "Station" && !knownStationIds.has(resource.resourceId)) {
      stations.push({ resource, roomGender: "", session: null });
      knownStationIds.add(resource.resourceId);
    }
    if (resource.resourceType === "Machine" && !knownMachineIds.has(resource.resourceId)) {
      machines.push({ resource, session: null });
      knownMachineIds.add(resource.resourceId);
    }
  }

  for (const session of supabaseSessions.filter((item) => item.status === "In Treatment")) {
    const station = stations.find((item) => item.resource.resourceId === session.stationId);
    if (!station) throw new Error(`CHAMBER_RUNTIME_CONFLICT:STATION_NOT_FOUND:${session.stationId}`);
    if (station.session && station.session.appointmentId !== session.appointmentId) {
      throw new Error(`CHAMBER_RUNTIME_CONFLICT:STATION_BUSY:${session.stationId}`);
    }
    station.session = session;

    if (session.currentResourceId) {
      const machine = machines.find((item) => item.resource.resourceId === session.currentResourceId);
      if (!machine) throw new Error(`CHAMBER_RUNTIME_CONFLICT:RESOURCE_NOT_FOUND:${session.currentResourceId}`);
      if (machine.session && machine.session.sessionId !== session.sessionId) {
        throw new Error(`CHAMBER_RUNTIME_CONFLICT:RESOURCE_BUSY:${session.currentResourceId}`);
      }
      machine.session = {
        sessionId: session.sessionId,
        patientId: session.patientId,
        patientName: session.patientName,
        expectedReleaseAt: session.expectedReleaseAt,
        currentStep: session.currentStep,
      };
    }
  }

  for (const station of stations) {
    station.roomGender = station.resource.resourceId === "TRACTION-BED"
      ? ""
      : roomGender(station.resource.roomId, allRunning);
  }

  const queue = new Map(sheets.queue.map((item) => [item.appointmentId, item]));
  const sessionByAppointment = new Map(supabaseSessions.map((item) => [item.appointmentId, item]));
  for (const appointment of bootstrap.appointments) {
    const appointmentId = normalize(appointment.id);
    const status = normalize(appointment.status) || "Scheduled";
    if (!appointmentId || !ACTIVE_APPOINTMENTS.has(normalized(status))) continue;
    const session = sessionByAppointment.get(appointmentId);
    if (normalized(status) === "in treatment" && !session) {
      throw new Error(`CHAMBER_RUNTIME_CONFLICT:SESSION_MISSING:${appointmentId}`);
    }
    if (session?.status === "In Treatment" || session?.status === "Completed") {
      queue.delete(appointmentId);
      continue;
    }
    queue.set(appointmentId, {
      appointmentId,
      patientId: normalize(appointment.patient_id),
      patientName: normalize(appointment.patient_name),
      gender: parseGender(appointment.gender),
      therapist: normalize(appointment.therapist),
      time: normalize(appointment.start_time),
      appointmentStatus: status,
      sessionId: session?.sessionId || "",
      sessionStatus: session?.status || "",
      recommendedStationId: normalize(appointment.bed_id),
      allocationWarning: "",
    });
  }

  return { ...sheets, stations, machines, queue: [...queue.values()] };
}

async function legacySafetyForSupabaseStart(
  context: AccessContext,
  appointment: SupabaseAppointmentRow
): Promise<void> {
  const sheets = await getSheetsChamberSnapshot(context);
  const bedId = normalize(appointment.bed_id);
  const station = sheets.stations.find((item) => item.resource.resourceId === bedId);
  if (station?.session) throw new Error(`CHAMBER_CAPACITY:STATION_BUSY:${bedId}`);
  if (bedId !== "TRACTION-BED" && station?.roomGender) {
    const gender = parseGender(appointment.gender);
    if (station.roomGender === "Mixed" || (gender && station.roomGender !== gender)) {
      throw new Error(`CHAMBER_CAPACITY:ROOM_GENDER:${station.roomGender}`);
    }
  }
}

async function legacySafetyForSupabaseStep(
  context: AccessContext,
  resourceId: string
): Promise<void> {
  if (!resourceId) return;
  const sheets = await getSheetsChamberSnapshot(context);
  const machine = sheets.machines.find((item) => item.resource.resourceId === resourceId);
  if (machine?.session) {
    throw new Error(`RESOURCE_BUSY:${resourceId}:${machine.session.patientName}`);
  }
}

/** Merge legacy Sheets runtime with new Supabase-only Physio runtime in exact cutover mode. */
export async function getChamberRuntimeSnapshot(context: AccessContext): Promise<ChamberSnapshot> {
  const sheets = await getSheetsChamberSnapshot(context);
  if (chamberDbMode() !== "supabase") return sheets;
  requireCutoverConfigured();
  const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
  return mergedSnapshot(sheets, bootstrap);
}

export async function receiveChamberRuntimePatient(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  appointmentIdInput: string
): Promise<{ sessionId: string }> {
  assertCanPerform(context, "chamber.receive", "Physio");
  const appointmentId = normalize(appointmentIdInput);
  if (chamberDbMode() !== "supabase") {
    return receiveSheetsChamberPatient(context, organizationId, clinicId, appointmentId);
  }
  requireCutoverConfigured();

  return withMutationLock(`chamber-runtime:${todayDhaka()}`, async () => {
    const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
    if (!findSupabaseAppointment(bootstrap, appointmentId)) {
      return receiveSheetsChamberPatient(context, organizationId, clinicId, appointmentId);
    }
    const result = await receiveSupabaseChamberSession({ appointmentId, actorId: context.staffId });
    return { sessionId: normalize(result.session.id) };
  });
}

export async function startChamberRuntimeSession(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  sessionIdInput: string
): Promise<{ sessionId: string; stationId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const sessionId = normalize(sessionIdInput);
  if (chamberDbMode() !== "supabase" || !sessionId.startsWith("CHS")) {
    return startSheetsChamberSession(context, organizationId, clinicId, sessionId);
  }
  requireCutoverConfigured();

  return withMutationLock(`chamber-runtime:${todayDhaka()}`, async () => {
    const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
    const rawSession = bootstrap.sessions.find((item) => normalize(item.id) === sessionId);
    if (!rawSession) throw new Error("CHAMBER_SESSION_NOT_FOUND");
    const appointment = findSupabaseAppointment(bootstrap, normalize(rawSession.appointment_id));
    if (!appointment) throw new Error("APPOINTMENT_NOT_FOUND");
    await assertRunAssignment(context, appointment);
    await legacySafetyForSupabaseStart(context, appointment);
    const result = await startSupabaseChamberSession({ sessionId, actorId: context.staffId });
    return { sessionId, stationId: normalize(result.session.station_id) };
  });
}

export async function updateChamberRuntimeStep(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  input: {
    sessionId: string;
    step: string;
    resourceId?: string;
    stationId?: string;
    durationMin?: number;
  }
): Promise<{ sessionId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const sessionId = normalize(input.sessionId);
  if (chamberDbMode() !== "supabase" || !sessionId.startsWith("CHS")) {
    return updateSheetsChamberStep(context, organizationId, clinicId, input);
  }
  requireCutoverConfigured();

  return withMutationLock(`chamber-runtime:${todayDhaka()}`, async () => {
    const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
    const rawSession = bootstrap.sessions.find((item) => normalize(item.id) === sessionId);
    if (!rawSession) throw new Error("CHAMBER_SESSION_NOT_FOUND");
    const appointment = findSupabaseAppointment(bootstrap, normalize(rawSession.appointment_id));
    if (!appointment) throw new Error("APPOINTMENT_NOT_FOUND");
    await assertRunAssignment(context, appointment);
    await legacySafetyForSupabaseStep(context, normalize(input.resourceId));
    await updateSupabaseChamberSessionStep({
      sessionId,
      actorId: context.staffId,
      step: input.step,
      resourceId: input.resourceId,
      stationId: input.stationId,
      durationMin: input.durationMin,
    });
    return { sessionId };
  });
}

export async function completeChamberRuntimeSession(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  sessionIdInput: string
): Promise<{ sessionId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const sessionId = normalize(sessionIdInput);
  if (chamberDbMode() !== "supabase" || !sessionId.startsWith("CHS")) {
    return completeSheetsChamberSession(context, organizationId, clinicId, sessionId);
  }
  requireCutoverConfigured();

  return withMutationLock(`chamber-runtime:${todayDhaka()}`, async () => {
    const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
    const rawSession = bootstrap.sessions.find((item) => normalize(item.id) === sessionId);
    if (!rawSession) throw new Error("CHAMBER_SESSION_NOT_FOUND");
    const appointment = findSupabaseAppointment(bootstrap, normalize(rawSession.appointment_id));
    if (!appointment) throw new Error("APPOINTMENT_NOT_FOUND");
    await assertRunAssignment(context, appointment);
    await completeSupabaseChamberSession({ sessionId, actorId: context.staffId });
    return { sessionId };
  });
}
