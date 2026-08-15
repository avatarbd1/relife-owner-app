import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  updateSheetValues,
} from "@/lib/data/googleSheets";
import { getPatientForContext, getAppointmentsForContext, todayDhaka, type AppointmentRecord } from "@/lib/webos/reception";
import { assertCanPerform, canPerform, type AccessContext } from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";

type SheetValue = string | number | boolean;
export type ChamberStatus = "Waiting" | "In Treatment" | "Completed" | "Cancelled";

export interface ChamberResource {
  resourceId: string;
  resourceName: string;
  resourceType: "Station" | "Machine";
  roomId: string;
  stationId: string;
  enabled: boolean;
  department: "Physio";
  notes: string;
  defaultDurationMin: number;
}

export interface ChamberStepLogItem {
  step: string;
  resourceId: string;
  startedAt: string;
  endedAt: string;
  plannedDurationMin: number;
}

export interface ChamberSession {
  sessionId: string;
  date: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  therapist: string;
  roomId: string;
  stationId: string;
  status: ChamberStatus;
  receivedAt: string;
  startedAt: string;
  currentStep: string;
  currentResourceId: string;
  stepStartedAt: string;
  stepDurationMin: number;
  expectedReleaseAt: string;
  stepLog: ChamberStepLogItem[];
  completedAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface ChamberQueueItem {
  appointmentId: string;
  patientId: string;
  patientName: string;
  gender: "Male" | "Female" | "";
  therapist: string;
  time: string;
  appointmentStatus: string;
  sessionId: string;
  sessionStatus: ChamberStatus | "";
  recommendedStationId: string;
  allocationWarning: string;
}

export interface ChamberStationView {
  resource: ChamberResource;
  roomGender: "Male" | "Female" | "Mixed" | "";
  session: ChamberSession | null;
}

export interface ChamberMachineView {
  resource: ChamberResource;
  session: Pick<ChamberSession, "sessionId" | "patientId" | "patientName" | "expectedReleaseAt" | "currentStep"> | null;
}

export interface ChamberSnapshot {
  date: string;
  generatedAt: string;
  permissions: {
    receive: boolean;
    run: boolean;
  };
  stations: ChamberStationView[];
  queue: ChamberQueueItem[];
  machines: ChamberMachineView[];
}

const SESSION_SHEET = "23_Chamber_Sessions";
const RESOURCE_SHEET = "24_Chamber_Resources";
const ACTIVE_APPOINTMENT_STATUSES = new Set(["scheduled", "arrived", "waiting", "in treatment"]);
const ACTIVE_SESSION_STATUSES = new Set<ChamberStatus>(["Waiting", "In Treatment"]);

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

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return headers.map((header) => map.get(normalized(header)) ?? "");
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

function parseBoolean(value: string): boolean {
  return ["true", "1", "yes", "y", "on"].includes(normalized(value));
}

function parseGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function nowDhaka(ref = new Date()): { date: string; iso: string; display: string } {
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
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${v.year}-${v.month}-${v.day}`;
  return {
    date,
    iso: `${date}T${v.hour}:${v.minute}:${v.second}+06:00`,
    display: `${date} ${v.hour}:${v.minute}:${v.second}`,
  };
}

function safeStepLog(value: string): ChamberStepLogItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const step = normalize((item as Record<string, unknown>).step);
      if (!step) return [];
      return [{
        step,
        resourceId: normalize((item as Record<string, unknown>).resourceId),
        startedAt: normalize((item as Record<string, unknown>).startedAt),
        endedAt: normalize((item as Record<string, unknown>).endedAt),
        plannedDurationMin: Number((item as Record<string, unknown>).plannedDurationMin || 0),
      }];
    });
  } catch {
    return [];
  }
}

function parseResources(rows: string[][]): ChamberResource[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const resourceId = at(row, idx("Resource_ID"));
    const resourceType = at(row, idx("Resource_Type"));
    if (!resourceId || !["station", "machine"].includes(resourceType.toLowerCase())) return [];
    return [{
      resourceId,
      resourceName: at(row, idx("Resource_Name")) || resourceId,
      resourceType: resourceType.toLowerCase() === "station" ? "Station" as const : "Machine" as const,
      roomId: at(row, idx("Room_ID")),
      stationId: at(row, idx("Station_ID")),
      enabled: parseBoolean(at(row, idx("Enabled"))),
      department: "Physio" as const,
      notes: at(row, idx("Notes")),
      defaultDurationMin: Number(at(row, idx("Default_Duration_Min")) || 0),
    }];
  });
}

function parseSessions(rows: string[][]): Array<ChamberSession & { sheetRow: number }> {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row, offset) => {
    const sessionId = at(row, idx("Session_ID"));
    if (!sessionId) return [];
    const rawStatus = at(row, idx("Status"));
    const status: ChamberStatus = ["Waiting", "In Treatment", "Completed", "Cancelled"].includes(rawStatus)
      ? rawStatus as ChamberStatus
      : "Waiting";
    return [{
      sessionId,
      date: at(row, idx("Date")),
      appointmentId: at(row, idx("Appointment_ID")),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      gender: parseGender(at(row, idx("Gender"))),
      therapist: at(row, idx("Therapist")),
      roomId: at(row, idx("Room_ID")),
      stationId: at(row, idx("Station_ID")),
      status,
      receivedAt: at(row, idx("Received_At")),
      startedAt: at(row, idx("Started_At")),
      currentStep: at(row, idx("Current_Step")),
      currentResourceId: at(row, idx("Current_Resource_ID")),
      stepStartedAt: at(row, idx("Step_Started_At")),
      stepDurationMin: Number(at(row, idx("Step_Duration_Min")) || 0),
      expectedReleaseAt: at(row, idx("Expected_Release_At")),
      stepLog: safeStepLog(at(row, idx("Step_Log_JSON"))),
      completedAt: at(row, idx("Completed_At")),
      updatedAt: at(row, idx("Updated_At")),
      updatedBy: at(row, idx("Updated_By")),
      version: Number(at(row, idx("Version")) || 1),
      sheetRow: offset + 2,
    }];
  });
}

function sessionValues(session: ChamberSession): Record<string, SheetValue> {
  return {
    Session_ID: session.sessionId,
    Date: session.date,
    Appointment_ID: session.appointmentId,
    Patient_ID: session.patientId,
    Patient_Name: session.patientName,
    Gender: session.gender,
    Therapist: session.therapist,
    Room_ID: session.roomId,
    Station_ID: session.stationId,
    Status: session.status,
    Received_At: session.receivedAt,
    Started_At: session.startedAt,
    Current_Step: session.currentStep,
    Current_Resource_ID: session.currentResourceId,
    Step_Started_At: session.stepStartedAt,
    Step_Duration_Min: session.stepDurationMin,
    Expected_Release_At: session.expectedReleaseAt,
    Step_Log_JSON: JSON.stringify(session.stepLog),
    Completed_At: session.completedAt,
    Updated_At: session.updatedAt,
    Updated_By: session.updatedBy,
    Department: "Physio",
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${session.sessionId}`,
    Provider_ID: session.updatedBy,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Version: session.version,
  };
}

async function loadChamberRows() {
  const snapshot = await fetchSheetRanges("physio", [SESSION_SHEET, RESOURCE_SHEET]);
  const sessionRows = snapshot[SESSION_SHEET] || [];
  const resourceRows = snapshot[RESOURCE_SHEET] || [];
  if (sessionRows.length === 0 || resourceRows.length === 0) throw new Error("CHAMBER_SCHEMA_MISSING");
  return {
    sessionRows,
    resourceRows,
    sessions: parseSessions(sessionRows),
    resources: parseResources(resourceRows).filter((item) => item.enabled),
  };
}

function activeSessions(sessions: ChamberSession[]): ChamberSession[] {
  return sessions.filter((session) => ACTIVE_SESSION_STATUSES.has(session.status));
}

function roomGender(
  roomId: string,
  sessions: ChamberSession[]
): "Male" | "Female" | "Mixed" | "" {
  const genders = new Set(
    activeSessions(sessions)
      .filter((session) => session.status === "In Treatment" && session.roomId === roomId && session.gender)
      .map((session) => session.gender)
  );
  if (genders.size === 0) return "";
  if (genders.size > 1) return "Mixed";
  return [...genders][0] as "Male" | "Female";
}

function preferredStationId(remarks: string): string {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  if (!match) return "";
  const map = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) map.set(key.trim().toLowerCase(), rest.join("=").trim());
  }
  const station = normalized(map.get("station"));
  const bed = normalized(map.get("bed"));
  if (station === "traction" || bed === "traction bed") return "TRACTION-BED";
  const number = /bed\s*([1-4])/.exec(bed)?.[1];
  return number ? `BED-${number}` : "";
}

function stationAvailable(
  station: ChamberResource,
  gender: "Male" | "Female" | "",
  sessions: ChamberSession[],
  ignoreSessionId = ""
): { ok: boolean; reason: string } {
  const occupied = activeSessions(sessions).some(
    (session) =>
      session.status === "In Treatment" &&
      session.stationId === station.resourceId &&
      session.sessionId !== ignoreSessionId
  );
  if (occupied) return { ok: false, reason: "STATION_BUSY" };
  if (station.resourceId === "TRACTION-BED") return { ok: true, reason: "" };
  if (!gender) return { ok: false, reason: "PATIENT_GENDER_REQUIRED" };
  const currentGender = roomGender(station.roomId, sessions.filter((s) => s.sessionId !== ignoreSessionId));
  if (currentGender && currentGender !== gender) {
    return { ok: false, reason: `ROOM_GENDER:${currentGender}` };
  }
  return { ok: true, reason: "" };
}

function chooseStation(
  resources: ChamberResource[],
  sessions: ChamberSession[],
  gender: "Male" | "Female" | "",
  preferred = "",
  ignoreSessionId = ""
): { station: ChamberResource | null; warning: string } {
  const stations = resources.filter((resource) => resource.resourceType === "Station");
  const preferredResource = stations.find((resource) => resource.resourceId === preferred);
  if (preferredResource) {
    const check = stationAvailable(preferredResource, gender, sessions, ignoreSessionId);
    if (check.ok) return { station: preferredResource, warning: "" };
    if (preferredResource.resourceId === "TRACTION-BED") {
      return { station: null, warning: "Traction Bed busy" };
    }
  }
  if (!gender) return { station: null, warning: "Gender required before bed allocation" };

  const treatmentBeds = stations.filter((resource) => /^BED-[1-4]$/.test(resource.resourceId));
  const sameGender = treatmentBeds.filter((resource) => roomGender(resource.roomId, sessions) === gender);
  const neutral = treatmentBeds.filter((resource) => !roomGender(resource.roomId, sessions));
  for (const station of [...sameGender, ...neutral]) {
    if (stationAvailable(station, gender, sessions, ignoreSessionId).ok) {
      return { station, warning: "" };
    }
  }
  return { station: null, warning: "No gender-compatible treatment bed available" };
}

function machineAvailable(
  resourceId: string,
  sessions: ChamberSession[],
  ignoreSessionId: string
): { ok: boolean; patientName: string } {
  if (!resourceId) return { ok: true, patientName: "" };
  const busy = activeSessions(sessions).find(
    (session) =>
      session.status === "In Treatment" &&
      session.currentResourceId === resourceId &&
      session.sessionId !== ignoreSessionId
  );
  return busy ? { ok: false, patientName: busy.patientName } : { ok: true, patientName: "" };
}

function appointmentById(rows: AppointmentRecord[], appointmentId: string): AppointmentRecord | null {
  return rows.find((row) => row.appointmentId === appointmentId) || null;
}

async function assertRunAssignment(context: AccessContext, session: ChamberSession, appointment: AppointmentRecord | null) {
  if (context.roles.includes("Owner") || context.roles.includes("Manager")) return;
  if (!context.roles.includes("Therapist")) throw new Error("ACCESS_DENIED");
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");
  const assigned = normalized(appointment?.therapist || session.therapist);
  if (!assigned || ![identity.staffId, identity.fullName].map(normalized).includes(assigned)) {
    throw new Error("THERAPIST_NOT_ASSIGNED");
  }
}

async function appendChamberAudit(
  context: AccessContext,
  action: string,
  session: ChamberSession,
  after: string
) {
  const now = nowDhaka();
  try {
    await appendSheetValues("physio", "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.display,
      context.staffId,
      action,
      "ChamberSession",
      session.sessionId,
      session.patientId,
      "",
      after,
      "Live Chamber resource action",
      "RELIFE",
      "RELIFE-PHYSIO",
      "AMTALI-01",
      `RELIFE-PHYSIO:${session.sessionId}`,
      "",
      context.staffId,
      "web_pwa",
      "human_entry",
      false,
      true,
      "relife-uda-v1",
      now.iso,
      "Physio",
    ]]);
  } catch (error) {
    console.error("Chamber audit append failed", error);
  }
}

async function setAppointmentFlowFields(
  context: AccessContext,
  appointmentId: string,
  status: string,
  receivedBy = ""
) {
  const snapshot = await fetchSheetRanges("physio", ["04_Appointments"]);
  const rows = snapshot["04_Appointments"] || [];
  if (rows.length < 2) throw new Error("APPOINTMENT_NOT_FOUND");
  const h = rows[0];
  const idIdx = headerIndex(h, "Appointment_ID");
  const statusIdx = headerIndex(h, "Status");
  const receivedIdx = headerIndex(h, "Received_By");
  const rowOffset = rows.slice(1).findIndex((row) => at(row, idIdx) === appointmentId);
  if (rowOffset < 0 || statusIdx < 0) throw new Error("APPOINTMENT_NOT_FOUND");
  const sheetRow = rowOffset + 2;
  await updateSheetValues("physio", `'04_Appointments'!${columnLetter(statusIdx)}${sheetRow}`, [[status]]);
  if (receivedBy && receivedIdx >= 0) {
    await updateSheetValues("physio", `'04_Appointments'!${columnLetter(receivedIdx)}${sheetRow}`, [[receivedBy]]);
  }
  void context;
}

async function updateSessionRow(
  headers: string[],
  sheetRow: number,
  session: ChamberSession
) {
  await updateSheetValues(
    "physio",
    `'${SESSION_SHEET}'!A${sheetRow}:AF${sheetRow}`,
    [rowForHeaders(headers, sessionValues(session))]
  );
}

function closeCurrentStep(session: ChamberSession, endedAt: string): ChamberStepLogItem[] {
  if (!session.currentStep || !session.stepStartedAt) return session.stepLog;
  return [
    ...session.stepLog,
    {
      step: session.currentStep,
      resourceId: session.currentResourceId,
      startedAt: session.stepStartedAt,
      endedAt,
      plannedDurationMin: session.stepDurationMin,
    },
  ];
}

export async function getChamberSnapshot(context: AccessContext): Promise<ChamberSnapshot> {
  assertCanPerform(context, "chamber.read", "Physio");
  const today = todayDhaka();
  const [{ sessions, resources }, appointments] = await Promise.all([
    loadChamberRows(),
    getAppointmentsForContext(context, "physio", today),
  ]);
  const todaySessions = sessions.filter((session) => session.date === today);
  const active = activeSessions(todaySessions);
  const stations = resources
    .filter((resource) => resource.resourceType === "Station")
    .map((resource) => ({
      resource,
      roomGender: resource.resourceId === "TRACTION-BED" ? "" as const : roomGender(resource.roomId, active),
      session:
        active.find(
          (session) => session.status === "In Treatment" && session.stationId === resource.resourceId
        ) || null,
    }));
  const machines = resources
    .filter((resource) => resource.resourceType === "Machine")
    .map((resource) => {
      const session = active.find(
        (item) => item.status === "In Treatment" && item.currentResourceId === resource.resourceId
      );
      return {
        resource,
        session: session
          ? {
              sessionId: session.sessionId,
              patientId: session.patientId,
              patientName: session.patientName,
              expectedReleaseAt: session.expectedReleaseAt,
              currentStep: session.currentStep,
            }
          : null,
      };
    });

  const sessionByAppointment = new Map(todaySessions.map((session) => [session.appointmentId, session]));
  const queue = appointments.flatMap((appointment) => {
    if (!ACTIVE_APPOINTMENT_STATUSES.has(normalized(appointment.status))) return [];
    const session = sessionByAppointment.get(appointment.appointmentId);
    if (session?.status === "In Treatment" || session?.status === "Completed") return [];
    const preferred = preferredStationId(appointment.remarks);
    const allocation = session
      ? chooseStation(resources, active, session.gender, preferred, session.sessionId)
      : { station: null, warning: "Receive patient first" };
    return [{
      appointmentId: appointment.appointmentId,
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      gender: session?.gender || "",
      therapist: appointment.therapist,
      time: appointment.time,
      appointmentStatus: appointment.status,
      sessionId: session?.sessionId || "",
      sessionStatus: session?.status || "",
      recommendedStationId: allocation.station?.resourceId || "",
      allocationWarning: allocation.warning,
    }];
  });

  return {
    date: today,
    generatedAt: new Date().toISOString(),
    permissions: {
      receive: canPerform(context, "chamber.receive", "Physio"),
      run: canPerform(context, "chamber.run", "Physio"),
    },
    stations,
    queue,
    machines,
  };
}

export async function receiveChamberPatient(
  context: AccessContext,
  appointmentIdInput: string
): Promise<{ sessionId: string }> {
  assertCanPerform(context, "chamber.receive", "Physio");
  const appointmentId = normalize(appointmentIdInput);
  const today = todayDhaka();
  const [appointments, data] = await Promise.all([
    getAppointmentsForContext(context, "physio", today),
    loadChamberRows(),
  ]);
  const appointment = appointmentById(appointments, appointmentId);
  if (!appointment) throw new Error("APPOINTMENT_NOT_FOUND");
  const existing = data.sessions.find((session) => session.appointmentId === appointmentId);
  if (existing) return { sessionId: existing.sessionId };

  const patient = await getPatientForContext(context, appointment.patientId);
  if (!patient || patient.department !== "Physio") throw new Error("PATIENT_NOT_FOUND");
  const headers = data.sessionRows[0];
  const now = nowDhaka();
  const session: ChamberSession = {
    sessionId: `CHW${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    date: today,
    appointmentId,
    patientId: patient.patientId,
    patientName: patient.fullName,
    gender: parseGender(patient.gender),
    therapist: appointment.therapist || patient.therapist,
    roomId: "",
    stationId: "",
    status: "Waiting",
    receivedAt: now.iso,
    startedAt: "",
    currentStep: "",
    currentResourceId: "",
    stepStartedAt: "",
    stepDurationMin: 0,
    expectedReleaseAt: "",
    stepLog: [],
    completedAt: "",
    updatedAt: now.iso,
    updatedBy: context.staffId,
    version: 1,
  };
  await appendSheetValues("physio", `'${SESSION_SHEET}'!A:AF`, [
    rowForHeaders(headers, sessionValues(session)),
  ]);
  try {
    await setAppointmentFlowFields(context, appointmentId, "Arrived", context.staffId);
  } catch (error) {
    console.error("Chamber receive saved but appointment status sync failed", error);
  }
  await appendChamberAudit(context, "chamber.receive", session, "Waiting");
  return { sessionId: session.sessionId };
}

export async function startChamberSession(
  context: AccessContext,
  sessionIdInput: string
): Promise<{ sessionId: string; stationId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const sessionId = normalize(sessionIdInput);
  const today = todayDhaka();
  const [data, appointments] = await Promise.all([
    loadChamberRows(),
    getAppointmentsForContext(context, "physio", today),
  ]);
  const stored = data.sessions.find((session) => session.sessionId === sessionId);
  if (!stored) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  const appointment = appointmentById(appointments, stored.appointmentId);
  await assertRunAssignment(context, stored, appointment);
  if (stored.status === "Completed") throw new Error("CHAMBER_SESSION_COMPLETED");
  if (stored.status === "In Treatment") return { sessionId, stationId: stored.stationId };
  if (!stored.gender) throw new Error("PATIENT_GENDER_REQUIRED");

  const preferred = preferredStationId(appointment?.remarks || "");
  const allocation = chooseStation(data.resources, data.sessions, stored.gender, preferred, stored.sessionId);
  if (!allocation.station) throw new Error(`CHAMBER_CAPACITY:${allocation.warning}`);
  const now = nowDhaka();
  const next: ChamberSession = {
    ...stored,
    roomId: allocation.station.roomId,
    stationId: allocation.station.resourceId,
    status: "In Treatment",
    startedAt: stored.startedAt || now.iso,
    currentStep: stored.currentStep || "Treatment started",
    updatedAt: now.iso,
    updatedBy: context.staffId,
    version: stored.version + 1,
  };
  await updateSessionRow(data.sessionRows[0], stored.sheetRow, next);
  try {
    await setAppointmentFlowFields(context, stored.appointmentId, "In Treatment");
  } catch (error) {
    console.error("Chamber started but appointment status sync failed", error);
  }
  await appendChamberAudit(context, "chamber.start", next, allocation.station.resourceId);
  return { sessionId, stationId: allocation.station.resourceId };
}

export async function updateChamberStep(
  context: AccessContext,
  input: {
    sessionId: string;
    step: string;
    resourceId?: string;
    stationId?: string;
    durationMin?: number;
  }
): Promise<{ sessionId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const data = await loadChamberRows();
  const stored = data.sessions.find((session) => session.sessionId === normalize(input.sessionId));
  if (!stored) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  if (stored.status !== "In Treatment") throw new Error("CHAMBER_SESSION_NOT_RUNNING");
  const appointments = await getAppointmentsForContext(context, "physio", todayDhaka());
  await assertRunAssignment(context, stored, appointmentById(appointments, stored.appointmentId));

  const step = normalize(input.step);
  if (!step) throw new Error("CHAMBER_STEP_REQUIRED");
  const resourceId = normalize(input.resourceId);
  const stationId = normalize(input.stationId) || stored.stationId;
  const durationMin = Math.trunc(Number(input.durationMin || 0));
  if (!Number.isFinite(durationMin) || durationMin < 0 || durationMin > 180) {
    throw new Error("INVALID_STEP_DURATION");
  }

  const station = data.resources.find(
    (resource) => resource.resourceType === "Station" && resource.resourceId === stationId
  );
  if (!station) throw new Error("STATION_NOT_FOUND");
  const stationCheck = stationAvailable(station, stored.gender, data.sessions, stored.sessionId);
  if (!stationCheck.ok) throw new Error(`CHAMBER_CAPACITY:${stationCheck.reason}`);

  if (resourceId) {
    const resource = data.resources.find(
      (item) => item.resourceType === "Machine" && item.resourceId === resourceId
    );
    if (!resource) throw new Error("RESOURCE_NOT_FOUND");
    const availability = machineAvailable(resourceId, data.sessions, stored.sessionId);
    if (!availability.ok) throw new Error(`RESOURCE_BUSY:${resourceId}:${availability.patientName}`);
  }

  const now = nowDhaka();
  const expected = durationMin > 0
    ? new Date(Date.now() + durationMin * 60_000).toISOString()
    : "";
  const next: ChamberSession = {
    ...stored,
    roomId: station.roomId,
    stationId: station.resourceId,
    stepLog: closeCurrentStep(stored, now.iso),
    currentStep: step,
    currentResourceId: resourceId,
    stepStartedAt: now.iso,
    stepDurationMin: durationMin,
    expectedReleaseAt: expected,
    updatedAt: now.iso,
    updatedBy: context.staffId,
    version: stored.version + 1,
  };
  await updateSessionRow(data.sessionRows[0], stored.sheetRow, next);
  await appendChamberAudit(
    context,
    "chamber.step.update",
    next,
    JSON.stringify({ step, resourceId, stationId, durationMin })
  );
  return { sessionId: next.sessionId };
}

export async function completeChamberSession(
  context: AccessContext,
  sessionIdInput: string
): Promise<{ sessionId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const data = await loadChamberRows();
  const stored = data.sessions.find((session) => session.sessionId === normalize(sessionIdInput));
  if (!stored) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  if (stored.status === "Completed") return { sessionId: stored.sessionId };
  const appointments = await getAppointmentsForContext(context, "physio", todayDhaka());
  await assertRunAssignment(context, stored, appointmentById(appointments, stored.appointmentId));
  const now = nowDhaka();
  const next: ChamberSession = {
    ...stored,
    status: "Completed",
    stepLog: closeCurrentStep(stored, now.iso),
    completedAt: now.iso,
    expectedReleaseAt: "",
    updatedAt: now.iso,
    updatedBy: context.staffId,
    version: stored.version + 1,
  };
  await updateSessionRow(data.sessionRows[0], stored.sheetRow, next);
  try {
    await setAppointmentFlowFields(context, stored.appointmentId, "Completed");
  } catch (error) {
    console.error("Chamber completed but appointment status sync failed", error);
  }
  await appendChamberAudit(context, "chamber.complete", next, `Steps: ${next.stepLog.length}`);
  return { sessionId: next.sessionId };
}
