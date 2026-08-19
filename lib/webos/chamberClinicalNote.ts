import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import {
  chamberDbMode,
  chamberSupabaseConfigured,
  getSupabaseChamberBootstrap,
} from "@/lib/data/supabaseChamber";
import {
  buildChamberClinicalFields,
  type ChamberTreatmentStepInput,
} from "@/lib/domain/chamber/clinicalNote";
import { recordTreatmentDocumentationGamification } from "@/lib/domain/gamification/events";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getPatientForContext, todayDhaka } from "@/lib/webos/reception";
import {
  appendEntityWithCellUpdatesAndAudit,
  type SheetCellUpdate,
  type SheetCellValue,
} from "@/lib/webos/sheetTransaction";

export interface ChamberTreatmentCapture {
  sessionId: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  therapist: string;
  startedAt: string;
  currentStep: string;
  currentResourceId: string;
  stepStartedAt: string;
  stepDurationMin: number;
  stepLog: ChamberTreatmentStepInput[];
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function num(value: unknown): number {
  const parsed = Number(normalize(value));
  return Number.isFinite(parsed) ? parsed : 0;
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

function rowForHeaders(
  headers: string[],
  values: Record<string, SheetCellValue>
): SheetCellValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function parseStepLog(value: unknown): ChamberTreatmentStepInput[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const step = normalize(row.step);
    if (!step) return [];
    return [
      {
        step,
        resourceId: normalize(row.resourceId ?? row.resource_id),
        startedAt: normalize(row.startedAt ?? row.started_at),
        endedAt: normalize(row.endedAt ?? row.ended_at),
        plannedDurationMin: num(
          row.plannedDurationMin ?? row.planned_duration_min
        ),
      },
    ];
  });
}

function dhakaNow(ref = new Date()) {
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
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    date,
    timestamp: `${date} ${values.hour}:${values.minute}:${values.second}`,
    iso: ref.toISOString(),
  };
}

async function captureFromSheets(
  sessionId: string
): Promise<ChamberTreatmentCapture> {
  const snapshot = await fetchSheetRanges("physio", ["23_Chamber_Sessions"]);
  const rows = snapshot["23_Chamber_Sessions"] || [];
  if (rows.length < 2) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  const headers = rows[0];
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  const row = rows
    .slice(1)
    .find((item) => at(item, idx("Session_ID")) === sessionId);
  if (!row) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  return {
    sessionId,
    appointmentId: at(row, idx("Appointment_ID")),
    patientId: at(row, idx("Patient_ID")),
    patientName: at(row, idx("Patient_Name")),
    therapist: at(row, idx("Therapist")),
    startedAt: at(row, idx("Started_At")),
    currentStep: at(row, idx("Current_Step")),
    currentResourceId: at(row, idx("Current_Resource_ID")),
    stepStartedAt: at(row, idx("Step_Started_At")),
    stepDurationMin: num(at(row, idx("Step_Duration_Min"))),
    stepLog: parseStepLog(at(row, idx("Step_Log_JSON"))),
  };
}

async function captureFromSupabase(
  sessionId: string
): Promise<ChamberTreatmentCapture> {
  if (!chamberSupabaseConfigured()) {
    throw new Error("SUPABASE_EDGE_SECRET_MISSING");
  }
  const bootstrap = await getSupabaseChamberBootstrap(todayDhaka());
  const row = bootstrap.sessions.find(
    (item) => normalize(item.id) === sessionId
  );
  if (!row) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  return {
    sessionId,
    appointmentId: normalize(row.appointment_id),
    patientId: normalize(row.patient_id),
    patientName: normalize(row.patient_name),
    therapist: normalize(row.therapist),
    startedAt: normalize(row.started_at),
    currentStep: normalize(row.current_step),
    currentResourceId: normalize(row.current_resource_id),
    stepStartedAt: normalize(row.step_started_at),
    stepDurationMin: num(row.step_duration_min),
    stepLog: parseStepLog(row.step_log),
  };
}

export async function captureChamberTreatmentForCompletion(
  context: AccessContext,
  sessionIdInput: unknown
): Promise<ChamberTreatmentCapture> {
  assertCanPerform(context, "chamber.run", "Physio");
  const sessionId = normalize(sessionIdInput);
  if (!sessionId) throw new Error("CHAMBER_SESSION_NOT_FOUND");
  if (chamberDbMode() === "supabase" && sessionId.startsWith("CHS")) {
    return captureFromSupabase(sessionId);
  }
  return captureFromSheets(sessionId);
}

function finalSteps(
  capture: ChamberTreatmentCapture,
  completedAt: string
): ChamberTreatmentStepInput[] {
  const steps = [...capture.stepLog];
  const current = normalize(capture.currentStep);
  if (
    current &&
    current.toLowerCase() !== "treatment started" &&
    capture.stepStartedAt
  ) {
    const last = steps[steps.length - 1];
    const sameOpenStep =
      last &&
      normalized(last.step) === normalized(current) &&
      normalize(last.startedAt) === normalize(capture.stepStartedAt);
    if (!sameOpenStep) {
      steps.push({
        step: current,
        resourceId: capture.currentResourceId,
        startedAt: capture.stepStartedAt,
        endedAt: completedAt,
        plannedDurationMin: capture.stepDurationMin,
      });
    }
  }
  return steps;
}

function auditRow(
  context: AccessContext,
  treatmentId: string,
  capture: ChamberTreatmentCapture,
  summary: string,
  now: ReturnType<typeof dhakaNow>
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    "clinical.session.auto_from_chamber",
    "Treatment",
    treatmentId,
    capture.patientId,
    "",
    summary,
    `Auto-saved from Chamber completion ${capture.sessionId}`,
    "RELIFE",
    "RELIFE-PHYSIO",
    "AMTALI-01",
    `RELIFE-PHYSIO:${treatmentId}`,
    "",
    context.staffId,
    "web_pwa",
    "chamber_completion",
    false,
    true,
    "relife-uda-v1",
    now.iso,
    "Physio",
  ];
}

export async function recordChamberCompletionTreatmentNote(
  context: AccessContext,
  capture: ChamberTreatmentCapture,
  completedAt = new Date().toISOString()
): Promise<{ treatmentId: string; sessionNo: number; duplicate: boolean }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const patient = await getPatientForContext(context, capture.patientId);
  if (!patient || patient.department !== "Physio") {
    throw new Error("PATIENT_NOT_FOUND");
  }

  const snapshot = await fetchSheetRanges("physio", [
    "12_Treatment_Plans",
    "05_Treatments",
  ]);
  const planRows = snapshot["12_Treatment_Plans"] || [];
  const treatmentRows = snapshot["05_Treatments"] || [];
  if (treatmentRows.length === 0) throw new Error("CLINICAL_SCHEMA_MISMATCH");

  const headers = treatmentRows[0];
  const tidx = (...names: string[]) => headerIndex(headers, ...names);
  const patientIdx = tidx("Patient_ID");
  const remarksIdx = tidx("Remarks");
  const treatmentIdIdx = tidx("Treatment_ID");
  const sessionNoIdx = tidx("Session_No");
  const planIdTreatmentIdx = tidx("Plan_ID");
  if ([patientIdx, treatmentIdIdx, sessionNoIdx].some((index) => index < 0)) {
    throw new Error("CLINICAL_SCHEMA_MISMATCH");
  }

  const marker = `[CHAMBER_SESSION:${capture.sessionId}]`;
  const existing = treatmentRows.slice(1).find(
    (row) =>
      at(row, patientIdx) === capture.patientId &&
      remarksIdx >= 0 &&
      at(row, remarksIdx).includes(marker)
  );
  if (existing) {
    return {
      treatmentId: at(existing, treatmentIdIdx),
      sessionNo: num(at(existing, sessionNoIdx)),
      duplicate: true,
    };
  }

  let activePlanId = "";
  let activeDiagnosis = "";
  let activeSessionsDone = 0;
  let activePlanRowNumber = 0;
  let sessionsDoneColumn = 0;
  if (planRows.length > 0) {
    const planHeaders = planRows[0];
    const pidx = (...names: string[]) => headerIndex(planHeaders, ...names);
    const planPatientIdx = pidx("Patient_ID");
    const planStatusIdx = pidx("Status");
    const planIdIdx = pidx("Plan_ID");
    const diagnosisIdx = pidx("Diagnosis");
    const sessionsDoneIdx = pidx("Sessions_Done");
    for (let index = planRows.length - 1; index >= 1; index -= 1) {
      const row = planRows[index];
      if (at(row, planPatientIdx) !== capture.patientId) continue;
      if (normalized(at(row, planStatusIdx) || "Active") !== "active") continue;
      activePlanId = at(row, planIdIdx);
      activeDiagnosis = at(row, diagnosisIdx);
      activeSessionsDone = num(at(row, sessionsDoneIdx));
      activePlanRowNumber = index + 1;
      sessionsDoneColumn = sessionsDoneIdx + 1;
      break;
    }
  }

  const patientTreatments = treatmentRows
    .slice(1)
    .filter((row) => at(row, patientIdx) === capture.patientId);
  const planTreatments = activePlanId
    ? patientTreatments.filter(
        (row) => at(row, planIdTreatmentIdx) === activePlanId
      )
    : [];
  const sessionNo = activePlanId
    ? planTreatments.length + 1
    : Math.max(
        0,
        ...patientTreatments.map((row) => num(at(row, sessionNoIdx)))
      ) + 1;

  const now = dhakaNow();
  const treatmentId = `TRC${randomUUID()
    .replace(/-/g, "")
    .slice(0, 9)
    .toUpperCase()}`;
  const fields = buildChamberClinicalFields(finalSteps(capture, completedAt));
  const remarks = `${marker} Auto-saved from Chamber completion. Appointment ${capture.appointmentId}.`;
  const treatmentRow = rowForHeaders(headers, {
    Treatment_ID: treatmentId,
    Date: now.date,
    Patient_ID: capture.patientId,
    Patient_Name: patient.fullName || capture.patientName,
    Diagnosis: activeDiagnosis || patient.diagnosis,
    Treatment_Given: fields.treatmentGiven,
    Exercise: "",
    Electrotherapy: fields.electrotherapy,
    Manual_Therapy: fields.manualTherapy,
    Session_No: sessionNo,
    Therapist: capture.therapist || patient.therapist,
    Remarks: remarks,
    Plan_ID: activePlanId,
    Pain: "",
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${treatmentId}`,
    Encounter_ID: `ENC-${capture.sessionId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "chamber_completion",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.iso,
    Department: "Physio",
    Pain_Before: "",
    Pain_After: "",
    Response: "",
    Modification: "",
  });

  const updates: SheetCellUpdate[] = [];
  if (activePlanRowNumber > 0 && sessionsDoneColumn > 0) {
    updates.push({
      sheet: "12_Treatment_Plans",
      rowNumber: activePlanRowNumber,
      columnNumber: sessionsDoneColumn,
      value: Math.max(activeSessionsDone, sessionNo),
    });
  }

  await appendEntityWithCellUpdatesAndAudit(
    "physio",
    "05_Treatments",
    treatmentRow,
    updates,
    auditRow(
      context,
      treatmentId,
      capture,
      `${fields.treatmentGiven}; session ${sessionNo}`,
      now
    )
  );
  await recordTreatmentDocumentationGamification({
    treatmentId,
    patientId: capture.patientId,
    department: "Physio",
    clinicianReference: capture.therapist || patient.therapist,
    documentedAt: now.iso,
    actorContext: context,
    sourceType: "chamber_completion",
  });
  return { treatmentId, sessionNo, duplicate: false };
}
