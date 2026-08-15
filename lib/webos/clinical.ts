import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import type { PatientRecord } from "@/lib/patients";
import { assertCanPerform, canPerform, type AccessConditions, type AccessContext } from "@/lib/webos/access";
import { getActiveWebStaffById } from "@/lib/webos/staffDirectory";
import {
  getAppointmentsForContext,
  getPatientForContext,
  todayDhaka,
} from "@/lib/webos/reception";
import {
  appendEntityWithAudit,
  appendEntityWithCellUpdatesAndAudit,
  type SheetCellUpdate,
} from "@/lib/webos/sheetTransaction";

type SheetValue = string | number | boolean;

export interface ClinicalAssessment {
  assessmentId: string;
  category: string;
  testData: string;
  createdBy: string;
  createdAt: string;
}

export interface TreatmentPlanRecord {
  planId: string;
  patientId: string;
  patientName: string;
  diagnosis: string;
  totalSessions: number;
  sessionsDone: number;
  exercisePlan: string;
  electrotherapyPlan: string;
  manualTherapyPlan: string;
  createdBy: string;
  createdDate: string;
  status: string;
}

export interface TreatmentSessionRecord {
  treatmentId: string;
  date: string;
  patientId: string;
  sessionNo: number;
  therapist: string;
  planId: string;
  exercise: string;
  electrotherapy: string;
  manualTherapy: string;
  painBefore: string;
  painAfter: string;
  response: string;
  modification: string;
  remarks: string;
}

export interface ClinicalWorkspace {
  patient: Pick<PatientRecord, "patientId" | "fullName" | "department" | "diagnosis" | "therapist">;
  canWrite: boolean;
  assessments: ClinicalAssessment[];
  plans: TreatmentPlanRecord[];
  activePlan: TreatmentPlanRecord | null;
  sessions: TreatmentSessionRecord[];
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], name: string): number {
  const needle = name.toLowerCase();
  return headers.findIndex((header) => normalized(header) === needle);
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${v.year}-${v.month}-${v.day}`;
  return { date, timestamp: `${date} ${v.hour}:${v.minute}`, provenance: ref.toISOString() };
}

function webId(prefix: "AS" | "PL" | "TR"): string {
  return `${prefix}W${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function auditRow(
  context: AccessContext,
  action: string,
  entityType: string,
  entityId: string,
  patientId: string,
  afterValue: string,
  now: ReturnType<typeof dhakaNow>
): SheetValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.timestamp,
    context.staffId,
    action,
    entityType,
    entityId,
    patientId,
    "",
    afterValue,
    "Web OS W5 clinical action",
    "RELIFE",
    "RELIFE-PHYSIO",
    "AMTALI-01",
    `RELIFE-PHYSIO:${entityId}`,
    "",
    context.staffId,
    "web_pwa",
    "human_entry",
    false,
    true,
    "relife-uda-v1",
    now.provenance,
    "Physio",
  ];
}

function nameMatches(value: string, staffId: string, fullName: string): boolean {
  const needle = normalized(value);
  if (!needle) return false;
  return needle === normalized(staffId) || needle === normalized(fullName);
}

async function clinicalConditions(
  context: AccessContext,
  patient: PatientRecord
): Promise<AccessConditions> {
  if (context.roles.includes("Owner")) return {};
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) return {};
  const assignedToCurrentStaff = nameMatches(patient.therapist, identity.staffId, identity.fullName);
  let currentDayCrossCover = false;
  if (!assignedToCurrentStaff) {
    const appointments = await getAppointmentsForContext(context, "physio", todayDhaka());
    currentDayCrossCover = appointments.some(
      (row) =>
        row.patientId === patient.patientId &&
        nameMatches(row.therapist, identity.staffId, identity.fullName)
    );
  }
  return { assignedToCurrentStaff, currentDayCrossCover };
}

async function requirePhysioPatient(context: AccessContext, patientId: string): Promise<PatientRecord> {
  const patient = await getPatientForContext(context, patientId);
  if (!patient) throw new Error("PATIENT_NOT_FOUND");
  if (patient.department !== "Physio") throw new Error("CLINICAL_PHYSIO_ONLY");
  assertCanPerform(context, "clinical.read", "Physio");
  return patient;
}

async function assertClinicalWrite(context: AccessContext, patient: PatientRecord) {
  const conditions = await clinicalConditions(context, patient);
  assertCanPerform(context, "clinical.write", "Physio", conditions);
}

function parseAssessments(rows: string[][], patientId: string): ClinicalAssessment[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (at(row, idx("Patient_ID")) !== patientId) return [];
    const assessmentId = at(row, idx("Assessment_ID"));
    if (!assessmentId) return [];
    return [{
      assessmentId,
      category: at(row, idx("Category")),
      testData: at(row, idx("Test_Data")),
      createdBy: at(row, idx("Created_By")),
      createdAt: at(row, idx("Created_At")),
    }];
  }).reverse();
}

function parsePlans(rows: string[][], patientId: string): TreatmentPlanRecord[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (at(row, idx("Patient_ID")) !== patientId) return [];
    const planId = at(row, idx("Plan_ID"));
    if (!planId) return [];
    return [{
      planId,
      patientId,
      patientName: at(row, idx("Patient_Name")),
      diagnosis: at(row, idx("Diagnosis")),
      totalSessions: Number(at(row, idx("Total_Sessions")) || 0),
      sessionsDone: Number(at(row, idx("Sessions_Done")) || 0),
      exercisePlan: at(row, idx("Exercise_Plan")),
      electrotherapyPlan: at(row, idx("Electrotherapy_Plan")),
      manualTherapyPlan: at(row, idx("Manual_Therapy_Plan")),
      createdBy: at(row, idx("Created_By")),
      createdDate: at(row, idx("Created_Date")),
      status: at(row, idx("Status")) || "Active",
    }];
  }).reverse();
}

function parseTreatments(rows: string[][], patientId: string): TreatmentSessionRecord[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (at(row, idx("Patient_ID")) !== patientId) return [];
    const treatmentId = at(row, idx("Treatment_ID"));
    if (!treatmentId) return [];
    return [{
      treatmentId,
      date: at(row, idx("Date")),
      patientId,
      sessionNo: Number(at(row, idx("Session_No")) || 0),
      therapist: at(row, idx("Therapist")),
      planId: at(row, idx("Plan_ID")),
      exercise: at(row, idx("Exercise")),
      electrotherapy: at(row, idx("Electrotherapy")),
      manualTherapy: at(row, idx("Manual_Therapy")),
      painBefore: at(row, idx("Pain_Before")) || at(row, idx("Pain")),
      painAfter: at(row, idx("Pain_After")),
      response: at(row, idx("Response")),
      modification: at(row, idx("Modification")),
      remarks: at(row, idx("Remarks")),
    }];
  }).reverse();
}

export async function getClinicalWorkspace(
  context: AccessContext,
  patientId: string
): Promise<ClinicalWorkspace> {
  const patient = await requirePhysioPatient(context, patientId);
  const snapshot = await fetchSheetRanges("physio", ["10_Assessments", "12_Treatment_Plans", "05_Treatments"]);
  const assessments = parseAssessments(snapshot["10_Assessments"] || [], patient.patientId);
  const plans = parsePlans(snapshot["12_Treatment_Plans"] || [], patient.patientId);
  const sessions = parseTreatments(snapshot["05_Treatments"] || [], patient.patientId);
  const conditions = await clinicalConditions(context, patient);
  const canWrite = canPerform(context, "clinical.write", "Physio", conditions);
  return {
    patient: {
      patientId: patient.patientId,
      fullName: patient.fullName,
      department: patient.department,
      diagnosis: patient.diagnosis,
      therapist: patient.therapist,
    },
    canWrite,
    assessments,
    plans,
    activePlan: plans.find((plan) => plan.status.toLowerCase() === "active") || null,
    sessions,
  };
}

export async function addQuickAssessment(
  context: AccessContext,
  input: { patientId: string; category: string; findings: string }
): Promise<{ assessmentId: string }> {
  const patient = await requirePhysioPatient(context, normalize(input.patientId));
  await assertClinicalWrite(context, patient);
  const category = normalize(input.category).toLowerCase() || "general";
  const findings = normalize(input.findings);
  if (!findings) throw new Error("ASSESSMENT_FINDINGS_REQUIRED");
  const snapshot = await fetchSheetRanges("physio", ["10_Assessments"]);
  const rows = snapshot["10_Assessments"] || [];
  if (rows.length === 0) throw new Error("CLINICAL_SCHEMA_MISMATCH");
  const headers = rows[0];
  const now = dhakaNow();
  const assessmentId = webId("AS");
  const assessmentRow = rowForHeaders(headers, {
    Assessment_ID: assessmentId,
    Patient_ID: patient.patientId,
    Category: category,
    Test_Data: JSON.stringify({ Mode: "Quick", Findings: findings }),
    Created_By: context.staffId,
    Created_At: now.timestamp,
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${assessmentId}`,
    Encounter_ID: `ENC-${assessmentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: "Physio",
  });
  await appendEntityWithAudit(
    "physio",
    "10_Assessments",
    assessmentRow,
    auditRow(context, "clinical.assessment.create", "Assessment", assessmentId, patient.patientId, findings, now)
  );
  return { assessmentId };
}

export async function createTreatmentPlan(
  context: AccessContext,
  input: {
    patientId: string;
    diagnosis?: string;
    totalSessions: number;
    exercisePlan?: string;
    electrotherapyPlan?: string;
    manualTherapyPlan?: string;
  }
): Promise<{ planId: string }> {
  const patient = await requirePhysioPatient(context, normalize(input.patientId));
  await assertClinicalWrite(context, patient);
  const totalSessions = Math.trunc(Number(input.totalSessions));
  if (!Number.isFinite(totalSessions) || totalSessions <= 0 || totalSessions > 365) throw new Error("INVALID_TOTAL_SESSIONS");
  const snapshot = await fetchSheetRanges("physio", ["12_Treatment_Plans"]);
  const rows = snapshot["12_Treatment_Plans"] || [];
  if (rows.length === 0) throw new Error("CLINICAL_SCHEMA_MISMATCH");
  const headers = rows[0];
  const now = dhakaNow();
  const planId = webId("PL");
  const planRow = rowForHeaders(headers, {
    Plan_ID: planId,
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Diagnosis: normalize(input.diagnosis) || patient.diagnosis,
    Total_Sessions: totalSessions,
    Sessions_Done: 0,
    Exercise_Plan: normalize(input.exercisePlan),
    Electrotherapy_Plan: normalize(input.electrotherapyPlan),
    Manual_Therapy_Plan: normalize(input.manualTherapyPlan),
    Created_By: context.staffId,
    Created_Date: now.date,
    Status: "Active",
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${planId}`,
    Encounter_ID: `ENC-${planId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: "Physio",
  });

  const patientIdx = headerIndex(headers, "Patient_ID");
  const statusIdx = headerIndex(headers, "Status");
  const updates: SheetCellUpdate[] = [];
  if (patientIdx >= 0 && statusIdx >= 0) {
    for (let i = 1; i < rows.length; i += 1) {
      if (
        at(rows[i], patientIdx) === patient.patientId &&
        at(rows[i], statusIdx).toLowerCase() === "active"
      ) {
        updates.push({
          sheet: "12_Treatment_Plans",
          rowNumber: i + 1,
          columnNumber: statusIdx + 1,
          value: "Superseded",
        });
      }
    }
  }

  await appendEntityWithCellUpdatesAndAudit(
    "physio",
    "12_Treatment_Plans",
    planRow,
    updates,
    auditRow(
      context,
      "clinical.plan.create",
      "TreatmentPlan",
      planId,
      patient.patientId,
      `Total sessions: ${totalSessions}`,
      now
    )
  );
  return { planId };
}

export async function recordTreatmentSession(
  context: AccessContext,
  input: {
    patientId: string;
    painBefore?: string;
    painAfter?: string;
    response?: string;
    modification?: string;
    remarks?: string;
  }
): Promise<{ treatmentId: string; sessionNo: number }> {
  const patient = await requirePhysioPatient(context, normalize(input.patientId));
  await assertClinicalWrite(context, patient);
  const identity = await getActiveWebStaffById(context.staffId);
  if (!identity) throw new Error("STAFF_NOT_FOUND");
  const snapshot = await fetchSheetRanges("physio", ["12_Treatment_Plans", "05_Treatments"]);
  const planRows = snapshot["12_Treatment_Plans"] || [];
  const treatmentRows = snapshot["05_Treatments"] || [];
  if (planRows.length === 0 || treatmentRows.length === 0) throw new Error("CLINICAL_SCHEMA_MISMATCH");
  const plans = parsePlans(planRows, patient.patientId);
  const activePlan = plans.find((plan) => plan.status.toLowerCase() === "active");
  if (!activePlan) throw new Error("ACTIVE_PLAN_REQUIRED");
  const sessions = parseTreatments(treatmentRows, patient.patientId);
  const sessionNo = sessions.filter((row) => row.planId === activePlan.planId).length + 1;
  const headers = treatmentRows[0];
  const now = dhakaNow();
  const treatmentId = webId("TR");
  const treatmentGiven = [
    activePlan.exercisePlan && `Exercise: ${activePlan.exercisePlan}`,
    activePlan.electrotherapyPlan && `Electrotherapy: ${activePlan.electrotherapyPlan}`,
    activePlan.manualTherapyPlan && `Manual: ${activePlan.manualTherapyPlan}`,
  ].filter(Boolean).join("; ");
  const treatmentRow = rowForHeaders(headers, {
    Treatment_ID: treatmentId,
    Date: now.date,
    Patient_ID: patient.patientId,
    Patient_Name: patient.fullName,
    Diagnosis: activePlan.diagnosis || patient.diagnosis,
    Treatment_Given: treatmentGiven,
    Exercise: activePlan.exercisePlan,
    Electrotherapy: activePlan.electrotherapyPlan,
    Manual_Therapy: activePlan.manualTherapyPlan,
    Session_No: sessionNo,
    Therapist: identity.fullName,
    Remarks: normalize(input.remarks),
    Plan_ID: activePlan.planId,
    Pain: normalize(input.painAfter) || normalize(input.painBefore),
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${treatmentId}`,
    Encounter_ID: `ENC-${treatmentId}`,
    Provider_ID: context.staffId,
    Source_System: "web_pwa",
    Source_Type: "human_entry",
    AI_Generated: false,
    Human_Verified: true,
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: "Physio",
    Pain_Before: normalize(input.painBefore),
    Pain_After: normalize(input.painAfter),
    Response: normalize(input.response),
    Modification: normalize(input.modification),
  });

  const planHeaders = planRows[0];
  const planIdIdx = headerIndex(planHeaders, "Plan_ID");
  const sessionsDoneIdx = headerIndex(planHeaders, "Sessions_Done");
  const planRowOffset = planRows.slice(1).findIndex((row) => at(row, planIdIdx) === activePlan.planId);
  const updates: SheetCellUpdate[] = [];
  if (planRowOffset >= 0 && sessionsDoneIdx >= 0) {
    updates.push({
      sheet: "12_Treatment_Plans",
      rowNumber: planRowOffset + 2,
      columnNumber: sessionsDoneIdx + 1,
      value: sessionNo,
    });
  }

  await appendEntityWithCellUpdatesAndAudit(
    "physio",
    "05_Treatments",
    treatmentRow,
    updates,
    auditRow(
      context,
      "clinical.session.create",
      "Treatment",
      treatmentId,
      patient.patientId,
      `Session ${sessionNo}; plan ${activePlan.planId}`,
      now
    )
  );
  return { treatmentId, sessionNo };
}
