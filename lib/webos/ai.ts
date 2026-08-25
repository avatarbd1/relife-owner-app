import "server-only";

import { randomUUID } from "node:crypto";
import { appendSheetValues, fetchSheetRanges } from "@/lib/data/googleSheets";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import { getClinicalWorkspace } from "@/lib/webos/clinical";

type SheetValue = string | number | boolean;

const CLINIC_EQUIPMENT = [
  "TENS",
  "IFT",
  "Ultrasound",
  "SWD",
  "Shockwave Therapy",
  "EMS",
  "Dry Needling",
  "Electroacupuncture",
  "Hot Pack",
  "Cold Pack/Ice",
  "Wax Bath",
  "ISTM",
  "Mulligan Belt",
  "Cupping",
  "Theraband",
  "Manual Therapy",
  "Exercise Therapy",
];

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => normalized(header) === name.toLowerCase());
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
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
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    date,
    timestamp: `${date} ${values.hour}:${values.minute}`,
    provenance: ref.toISOString(),
  };
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY);
}

async function callAi(system: string, prompt: string, maxTokens = 1000): Promise<string> {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const useOpenRouter = Boolean(openRouterKey);
  const key = openRouterKey || groqKey;
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  const url = useOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const model = useOpenRouter
    ? process.env.OPENROUTER_MODEL_NAME || "openai/gpt-4o-mini"
    : process.env.GROQ_MODEL_NAME || "llama-3.3-70b-versatile";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.25,
      max_tokens: maxTokens,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("AI_EMPTY_RESPONSE");
  return answer;
}

export async function answerClinicalAi(
  context: AccessContext,
  clinicId: string,
  input: { question: string; patientId?: string }
): Promise<{ answer: string; contextUsed: string }> {
  if (!canPerform(context, "clinical.read", "Physio")) throw new Error("ACCESS_DENIED");
  const question = normalize(input.question).slice(0, 4000);
  if (question.length < 3) throw new Error("QUESTION_REQUIRED");

  let clinicalContext: Record<string, unknown> = {};
  let contextUsed = "General Physio question";
  if (normalize(input.patientId)) {
    const workspace = await getClinicalWorkspace(context, clinicId, normalize(input.patientId));
    clinicalContext = {
      diagnosis: workspace.patient.diagnosis,
      activePlan: workspace.activePlan
        ? {
            totalSessions: workspace.activePlan.totalSessions,
            sessionsDone: workspace.activePlan.sessionsDone,
            exercisePlan: workspace.activePlan.exercisePlan,
            electrotherapyPlan: workspace.activePlan.electrotherapyPlan,
            manualTherapyPlan: workspace.activePlan.manualTherapyPlan,
          }
        : null,
      recentAssessments: workspace.assessments.slice(0, 4).map((item) => ({
        category: item.category,
        findings: item.testData,
      })),
      recentSessions: workspace.sessions.slice(0, 5).map((item) => ({
        date: item.date,
        sessionNo: item.sessionNo,
        painBefore: item.painBefore,
        painAfter: item.painAfter,
        response: item.response,
        modification: item.modification,
      })),
    };
    contextUsed = "Authorized patient clinical context (identifiers removed)";
  }

  const system = [
    "You are the Relife Physiotherapy clinical assistant for qualified clinic staff.",
    "Reply in concise practical Bangla. Prioritize red flags and referral/escalation when appropriate.",
    "Do not invent examination findings, diagnosis, contraindications, or treatment response.",
    "Separate what is known from what should be assessed next.",
    `Available clinic equipment: ${CLINIC_EQUIPMENT.join(", ")}. Do not recommend unavailable equipment as if it exists.`,
    "This is clinician decision support, not autonomous diagnosis or prescribing.",
  ].join("\n");
  const prompt = `Staff question:\n${question}\n\nMinimum necessary clinical context (no patient name, phone, address or ID):\n${JSON.stringify(clinicalContext)}`;
  const answer = await callAi(system, prompt, 1100);
  return { answer, contextUsed };
}

const SAFE_FIELDS: Record<string, string[]> = {
  "06_Payments": ["Date", "Department", "Amount", "Discount", "Due", "Time", "Session_Type"],
  "03_Attendance": ["Date", "Role", "Check_In", "Check_Out", "Working_Hours", "Late_Minutes", "Overtime", "Status"],
  "02_Patients": ["Registration_Date", "Department", "Total_Bill", "Paid", "Due", "Status"],
  "08_Staff": ["Role", "Salary", "Status", "Joining_Date", "Primary_Department"],
  "07_Expenses": ["Date", "Category", "Amount", "Department", "Status", "Type", "Paid_From"],
};

function chooseStaffSheet(question: string): keyof typeof SAFE_FIELDS {
  const q = normalized(question);
  if (/attendance|হাজিরা|late|লেট|overtime|চেক ইন|check in/.test(q)) return "03_Attendance";
  if (/expense|খরচ|ব্যয়|cost/.test(q)) return "07_Expenses";
  if (/staff|salary|বেতন|কর্মী/.test(q)) return "08_Staff";
  if (/patient|রোগী|registration|রেজিস্ট্র/.test(q)) return "02_Patients";
  return "06_Payments";
}

function safeRows(rows: string[][], sheetName: string): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const deptIdx = headerIndex(headers, "Department");
  const primaryDeptIdx = headerIndex(headers, "Primary_Department");
  const fields = SAFE_FIELDS[sheetName] || [];
  return rows.slice(1).flatMap((row) => {
    if (deptIdx >= 0 && at(row, deptIdx) !== "Physio") return [];
    if (sheetName === "08_Staff") {
      const primary = at(row, primaryDeptIdx);
      if (primary !== "Physio" && primary !== "All") return [];
    }
    const item: Record<string, string> = {};
    for (const field of fields) {
      const index = headerIndex(headers, field);
      if (index >= 0) item[field] = at(row, index);
    }
    return [item];
  }).slice(-120);
}

export async function answerStaffAi(
  context: AccessContext,
  questionInput: string
): Promise<{ answer: string; source: string }> {
  if (!context.roles.includes("Owner")) throw new Error("ACCESS_DENIED");
  const question = normalize(questionInput).slice(0, 2500);
  if (question.length < 3) throw new Error("QUESTION_REQUIRED");
  const source = chooseStaffSheet(question);
  const snapshot = await fetchSheetRanges("physio", [source]);
  const records = safeRows(snapshot[source] || [], source);
  const system = [
    "You are a clinic operations analyst answering the Relife owner in Bangla.",
    "Use only the supplied de-identified Physio operational rows. Do not infer missing people or records.",
    "Give exact arithmetic when possible and say when the available data is insufficient.",
    "Never request or expose patient/staff names, phone numbers, addresses, IDs or receipt numbers.",
  ].join("\n");
  const prompt = `Question: ${question}\nSource: ${source}\nDe-identified Physio rows:\n${JSON.stringify(records)}`;
  return { answer: await callAi(system, prompt, 900), source };
}

export async function generateCaseStudyLesson(
  context: AccessContext,
  clinicId: string,
  input: { patientId: string; lessonTitle?: string }
): Promise<{ caseStudyId: string; lessonNumber: number; content: string }> {
  const patientId = normalize(input.patientId);
  if (!patientId) throw new Error("PATIENT_REQUIRED");
  const workspace = await getClinicalWorkspace(context, clinicId, patientId);
  if (!workspace.canWrite) throw new Error("ACCESS_DENIED");
  const snapshot = await fetchSheetRanges("physio", ["15_Case_Studies"]);
  const rows = snapshot["15_Case_Studies"] || [];
  if (rows.length < 1) throw new Error("CASE_STUDY_SCHEMA_MISMATCH");
  const headers = rows[0];
  const patientIdx = headerIndex(headers, "Patient_ID");
  const lessonIdx = headerIndex(headers, "Lesson_Number");
  const existing = rows.slice(1).filter((row) => at(row, patientIdx) === patientId);
  const lessonNumber = existing.reduce(
    (max, row) => Math.max(max, Number(at(row, lessonIdx)) || 0),
    0
  ) + 1;
  const title = normalize(input.lessonTitle).slice(0, 120) || `Clinical Learning ${lessonNumber}`;
  const safeContext = {
    diagnosis: workspace.patient.diagnosis,
    assessments: workspace.assessments.slice(0, 6).map((item) => ({
      category: item.category,
      findings: item.testData,
    })),
    activePlan: workspace.activePlan
      ? {
          totalSessions: workspace.activePlan.totalSessions,
          sessionsDone: workspace.activePlan.sessionsDone,
          exercise: workspace.activePlan.exercisePlan,
          electrotherapy: workspace.activePlan.electrotherapyPlan,
          manualTherapy: workspace.activePlan.manualTherapyPlan,
        }
      : null,
    sessions: workspace.sessions.slice(0, 10).map((item) => ({
      sessionNo: item.sessionNo,
      painBefore: item.painBefore,
      painAfter: item.painAfter,
      response: item.response,
      modification: item.modification,
    })),
  };
  const system = [
    "Create a short educational case-study lesson for a physiotherapy clinician in Bangla.",
    "Use only supplied clinical facts; do not invent diagnosis, findings, outcomes or causal claims.",
    "Structure: Case pattern, clinical reasoning, what changed, what to reassess, learning points, red flags/limits.",
    "The output is professional learning material, not a patient-facing diagnosis.",
  ].join("\n");
  const content = await callAi(
    system,
    `Lesson title: ${title}\nDe-identified case context:\n${JSON.stringify(safeContext)}`,
    1300
  );
  const now = dhakaNow();
  const caseStudyId = `CSW${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const sessionId = workspace.sessions[0]?.treatmentId || workspace.activePlan?.planId || "";
  await appendSheetValues("physio", "'15_Case_Studies'!A:Z", [
    rowForHeaders(headers, {
      Case_Study_ID: caseStudyId,
      Session_ID: sessionId,
      Patient_ID: patientId,
      Patient_Name: workspace.patient.fullName,
      Lesson_Number: lessonNumber,
      Lesson_Title: title,
      Content: content,
      Created_By: context.staffId,
      Timestamp: now.timestamp,
      Organization_ID: "RELIFE",
      Clinic_ID: "RELIFE-PHYSIO",
      Branch_ID: "AMTALI-01",
      Record_ID: `RELIFE-PHYSIO:${caseStudyId}`,
      Encounter_ID: sessionId,
      Provider_ID: context.staffId,
      Source_System: "web_pwa",
      Source_Type: "ai_assisted",
      AI_Generated: true,
      Human_Verified: false,
      Schema_Version: "relife-uda-v1",
      Provenance_Timestamp: now.provenance,
    }),
  ]);
  try {
    await appendSheetValues("physio", "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      context.staffId,
      "case_study.generate",
      "CaseStudy",
      caseStudyId,
      patientId,
      "",
      title,
      "AI-assisted case study; clinician review required",
      "RELIFE",
      "RELIFE-PHYSIO",
      "AMTALI-01",
      `RELIFE-PHYSIO:${caseStudyId}`,
      sessionId,
      context.staffId,
      "web_pwa",
      "ai_assisted",
      true,
      false,
      "relife-uda-v1",
      now.provenance,
      "Physio",
    ]]);
  } catch (error) {
    console.error("Case study audit append failed", error);
  }
  return { caseStudyId, lessonNumber, content };
}
