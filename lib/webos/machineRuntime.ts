import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import {
  replaceEntityRowWithAudit,
  type SheetCellValue,
} from "@/lib/webos/sheetTransaction";
import { todayDhaka } from "@/lib/webos/reception";

const SESSION_SHEET = "23_Chamber_Sessions";
const RESOURCE_SHEET = "24_Chamber_Resources";
const ACTIVE = new Set(["waiting", "in treatment"]);
const TRACTION_MINUTES = 20;

type SessionStatus = "Waiting" | "In Treatment" | "Completed" | "Cancelled";

type MachineResource = {
  resourceId: string;
  resourceName: string;
  durationMin: number;
  traction: boolean;
};

type ActiveSession = {
  sessionId: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  therapist: string;
  status: SessionStatus;
  stationId: string;
  roomId: string;
  currentResourceId: string;
  currentStep: string;
  stepStartedAt: string;
  stepDurationMin: number;
  expectedReleaseAt: string;
  sheetRow: number;
  raw: string[];
};

export interface MachineOperationSnapshot {
  date: string;
  canOperate: boolean;
  canRunTreatment: boolean;
  machines: Array<{
    resourceId: string;
    resourceName: string;
    durationMin: number;
    traction: boolean;
    busy: boolean;
    sessionId: string;
    patientId: string;
    patientName: string;
    expectedReleaseAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    appointmentId: string;
    patientId: string;
    patientName: string;
    therapist: string;
    status: SessionStatus;
    stationId: string;
    currentResourceId: string;
    currentStep: string;
    expectedReleaseAt: string;
  }>;
}

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

function parseBoolean(value: unknown): boolean {
  return ["true", "1", "yes", "y", "on"].includes(normalized(value));
}

function isTraction(resourceId: string, resourceName: string): boolean {
  return /traction/i.test(`${resourceId} ${resourceName}`);
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
  const display = `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  return { display, iso: ref.toISOString() };
}

function ensureHeaders(headers: string[], names: string[]): void {
  const present = new Set(headers.map(normalized));
  if (names.some((name) => !present.has(name.toLowerCase()))) throw new Error("CHAMBER_SCHEMA_MISSING");
}

function parseResources(rows: string[][]): MachineResource[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Resource_ID");
  const nameIdx = headerIndex(headers, "Resource_Name");
  const typeIdx = headerIndex(headers, "Resource_Type");
  const enabledIdx = headerIndex(headers, "Enabled");
  const departmentIdx = headerIndex(headers, "Department");
  const durationIdx = headerIndex(headers, "Default_Duration_Min");
  return rows.slice(1).flatMap((row) => {
    const resourceId = at(row, idIdx);
    const resourceName = at(row, nameIdx) || resourceId;
    const traction = isTraction(resourceId, resourceName);
    if (!resourceId || normalized(at(row, departmentIdx)) !== "physio" || !parseBoolean(at(row, enabledIdx))) return [];
    if (normalized(at(row, typeIdx)) !== "machine" && !traction) return [];
    const configured = Number(at(row, durationIdx) || 0);
    return [{
      resourceId,
      resourceName: traction ? "Traction" : resourceName,
      durationMin: traction ? TRACTION_MINUTES : (Number.isFinite(configured) && configured > 0 ? configured : 15),
      traction,
    }];
  });
}

function parseSessions(rows: string[][], date: string): ActiveSession[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  return rows.slice(1).flatMap((row, offset) => {
    const sessionId = at(row, idx("Session_ID"));
    const status = at(row, idx("Status")) as SessionStatus;
    if (!sessionId || at(row, idx("Date")) !== date || !ACTIVE.has(normalized(status))) return [];
    return [{
      sessionId,
      appointmentId: at(row, idx("Appointment_ID")),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      therapist: at(row, idx("Therapist")),
      status,
      stationId: at(row, idx("Station_ID")),
      roomId: at(row, idx("Room_ID")),
      currentResourceId: at(row, idx("Current_Resource_ID")),
      currentStep: at(row, idx("Current_Step")),
      stepStartedAt: at(row, idx("Step_Started_At")),
      stepDurationMin: Number(at(row, idx("Step_Duration_Min")) || 0),
      expectedReleaseAt: at(row, idx("Expected_Release_At")),
      sheetRow: offset + 2,
      raw: [...row],
    }];
  });
}

function setCell(row: string[], headers: string[], name: string, value: string | number): void {
  const index = headerIndex(headers, name);
  if (index < 0) throw new Error("CHAMBER_SCHEMA_MISSING");
  while (row.length <= index) row.push("");
  row[index] = String(value);
}

function parseLog(value: string): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function machinePermission(context: AccessContext): boolean {
  return canPerform(context, "chamber.receive", "Physio") || canPerform(context, "chamber.run", "Physio");
}

function assertMachinePermission(context: AccessContext): void {
  if (!machinePermission(context)) throw new Error("ACCESS_DENIED");
}

function auditRow(
  context: AccessContext,
  action: string,
  session: ActiveSession,
  detail: string,
  now: ReturnType<typeof nowDhaka>
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.display,
    context.staffId,
    action,
    "ChamberMachineUse",
    session.sessionId,
    session.patientId,
    "",
    detail,
    "Live machine use; booking does not reserve machines",
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
  ];
}

async function loadRuntime(date = todayDhaka()) {
  const snapshot = await fetchSheetRanges("physio", [SESSION_SHEET, RESOURCE_SHEET]);
  const sessionRows = snapshot[SESSION_SHEET] || [];
  const resourceRows = snapshot[RESOURCE_SHEET] || [];
  if (!sessionRows.length || !resourceRows.length) throw new Error("CHAMBER_SCHEMA_MISSING");
  ensureHeaders(sessionRows[0], [
    "Session_ID",
    "Date",
    "Patient_ID",
    "Status",
    "Room_ID",
    "Station_ID",
    "Current_Step",
    "Current_Resource_ID",
    "Step_Started_At",
    "Step_Duration_Min",
    "Expected_Release_At",
    "Step_Log_JSON",
    "Updated_At",
    "Updated_By",
    "Version",
  ]);
  return {
    date,
    sessionRows,
    resources: parseResources(resourceRows),
    sessions: parseSessions(sessionRows, date),
  };
}

export async function getMachineOperationSnapshot(
  context: AccessContext
): Promise<MachineOperationSnapshot> {
  const runtime = await loadRuntime();
  const busyByResource = new Map(
    runtime.sessions
      .filter((session) => session.currentResourceId)
      .map((session) => [session.currentResourceId, session])
  );
  return {
    date: runtime.date,
    canOperate: machinePermission(context),
    canRunTreatment: canPerform(context, "chamber.run", "Physio"),
    machines: runtime.resources.map((resource) => {
      const session = busyByResource.get(resource.resourceId);
      return {
        ...resource,
        busy: Boolean(session),
        sessionId: session?.sessionId || "",
        patientId: session?.patientId || "",
        patientName: session?.patientName || "",
        expectedReleaseAt: session?.expectedReleaseAt || "",
      };
    }),
    sessions: runtime.sessions.map((session) => ({
      sessionId: session.sessionId,
      appointmentId: session.appointmentId,
      patientId: session.patientId,
      patientName: session.patientName,
      therapist: session.therapist,
      status: session.status,
      stationId: session.stationId,
      currentResourceId: session.currentResourceId,
      currentStep: session.currentStep,
      expectedReleaseAt: session.expectedReleaseAt,
    })),
  };
}

export async function startMachineUse(
  context: AccessContext,
  input: { sessionId: string; resourceId: string; durationMin?: number }
): Promise<{ sessionId: string; resourceId: string; expectedReleaseAt: string }> {
  assertMachinePermission(context);
  const runtime = await loadRuntime();
  const session = runtime.sessions.find((item) => item.sessionId === normalize(input.sessionId));
  if (!session) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  const resource = runtime.resources.find((item) => item.resourceId === normalize(input.resourceId));
  if (!resource) throw new Error("RESOURCE_NOT_FOUND");
  if (session.currentResourceId === resource.resourceId) {
    return { sessionId: session.sessionId, resourceId: resource.resourceId, expectedReleaseAt: session.expectedReleaseAt };
  }
  if (session.currentResourceId) throw new Error(`MACHINE_ALREADY_RUNNING:${session.currentResourceId}`);
  const busy = runtime.sessions.find(
    (item) => item.sessionId !== session.sessionId && item.currentResourceId === resource.resourceId
  );
  if (busy) throw new Error(`RESOURCE_BUSY:${resource.resourceId}:${busy.patientName}`);

  const requested = Math.trunc(Number(input.durationMin || 0));
  const durationMin = resource.traction
    ? TRACTION_MINUTES
    : Number.isFinite(requested) && requested > 0 && requested <= 180
      ? requested
      : resource.durationMin;
  const now = nowDhaka();
  const expectedReleaseAt = new Date(Date.now() + durationMin * 60_000).toISOString();
  const next = [...session.raw];
  setCell(next, runtime.sessionRows[0], "Current_Step", resource.resourceName);
  setCell(next, runtime.sessionRows[0], "Current_Resource_ID", resource.resourceId);
  setCell(next, runtime.sessionRows[0], "Step_Started_At", now.iso);
  setCell(next, runtime.sessionRows[0], "Step_Duration_Min", durationMin);
  setCell(next, runtime.sessionRows[0], "Expected_Release_At", expectedReleaseAt);
  setCell(next, runtime.sessionRows[0], "Updated_At", now.iso);
  setCell(next, runtime.sessionRows[0], "Updated_By", context.staffId);
  const versionIdx = headerIndex(runtime.sessionRows[0], "Version");
  setCell(next, runtime.sessionRows[0], "Version", Number(at(session.raw, versionIdx) || 1) + 1);

  // Traction is a machine, never a patient bed. If general treatment has ended
  // and traction starts, release the general station immediately.
  if (resource.traction && normalized(session.status) === "in treatment") {
    setCell(next, runtime.sessionRows[0], "Room_ID", "");
    setCell(next, runtime.sessionRows[0], "Station_ID", "");
  }

  await replaceEntityRowWithAudit(
    "physio",
    SESSION_SHEET,
    session.sheetRow,
    next,
    auditRow(
      context,
      "chamber.machine.start",
      session,
      JSON.stringify({ resourceId: resource.resourceId, durationMin, expectedReleaseAt, traction: resource.traction }),
      now
    )
  );
  return { sessionId: session.sessionId, resourceId: resource.resourceId, expectedReleaseAt };
}

export async function finishMachineUse(
  context: AccessContext,
  input: { sessionId: string; resourceId?: string }
): Promise<{ sessionId: string; resourceId: string }> {
  assertMachinePermission(context);
  const runtime = await loadRuntime();
  const session = runtime.sessions.find((item) => item.sessionId === normalize(input.sessionId));
  if (!session) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  if (!session.currentResourceId) return { sessionId: session.sessionId, resourceId: "" };
  if (input.resourceId && normalize(input.resourceId) !== session.currentResourceId) {
    throw new Error("MACHINE_USE_MISMATCH");
  }
  const now = nowDhaka();
  const headers = runtime.sessionRows[0];
  const next = [...session.raw];
  const logIdx = headerIndex(headers, "Step_Log_JSON");
  const log = parseLog(at(session.raw, logIdx));
  if (session.stepStartedAt) {
    log.push({
      step: session.currentStep || session.currentResourceId,
      resourceId: session.currentResourceId,
      startedAt: session.stepStartedAt,
      endedAt: now.iso,
      plannedDurationMin: session.stepDurationMin,
    });
  }
  setCell(next, headers, "Step_Log_JSON", JSON.stringify(log));
  setCell(next, headers, "Current_Step", "");
  setCell(next, headers, "Current_Resource_ID", "");
  setCell(next, headers, "Step_Started_At", "");
  setCell(next, headers, "Step_Duration_Min", 0);
  setCell(next, headers, "Expected_Release_At", "");
  setCell(next, headers, "Updated_At", now.iso);
  setCell(next, headers, "Updated_By", context.staffId);
  const versionIdx = headerIndex(headers, "Version");
  setCell(next, headers, "Version", Number(at(session.raw, versionIdx) || 1) + 1);

  const resourceId = session.currentResourceId;
  await replaceEntityRowWithAudit(
    "physio",
    SESSION_SHEET,
    session.sheetRow,
    next,
    auditRow(
      context,
      "chamber.machine.finish",
      session,
      JSON.stringify({ resourceId, startedAt: session.stepStartedAt, endedAt: now.iso }),
      now
    )
  );
  return { sessionId: session.sessionId, resourceId };
}
