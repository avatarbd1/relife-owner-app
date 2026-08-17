import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import { totalLatestPatientDue } from "@/lib/domain/finance/dailyRegisterMath";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

export interface DailyRegisterRow {
  receiptNo: string;
  sl: string;
  patientId: string;
  patientName: string;
  sessions: number;
  service: string;
  amount: number;
  discount: number;
  due: number;
  paymentMethod: string;
  receivedBy: string;
  status: "Paid" | "Partial" | "Due";
}

export interface TreatmentHistoryRow {
  treatmentId: string;
  date: string;
  patientId: string;
  patientName: string;
  diagnosis: string;
  sessionNo: number;
  therapist: string;
  treatmentGiven: string;
  painBefore: string;
  painAfter: string;
  response: string;
  modification: string;
}

export interface SalaryHistoryRow {
  paymentId: string;
  date: string;
  month: string;
  staffId: string;
  amount: number;
  paidBy: string;
  note: string;
  paidFrom: string;
  status: string;
}

export interface PatientReportRow {
  reportId: string;
  patientId: string;
  patientName: string;
  fileName: string;
  fileType: string;
  uploadDate: string;
  uploadedBy: string;
  driveLink: string;
  legacyTelegramFileId: string;
}

export interface CaseStudyRow {
  caseStudyId: string;
  sessionId: string;
  patientId: string;
  patientName: string;
  lessonNumber: number;
  lessonTitle: string;
  content: string;
  createdBy: string;
  timestamp: string;
}

export interface LearningRow {
  staffId: string;
  fullName: string;
  role: string;
  date: string;
  type: string;
  itemId: string;
  category: string;
  selectedAnswer: string;
  correct: string;
  timestamp: string;
}

export interface AuditRow {
  auditId: string;
  timestamp: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  patientId: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
}

export interface DeleteLogRow {
  timestamp: string;
  deletedBy: string;
  type: string;
  receiptNo: string;
  patientId: string;
  patientName: string;
  amount: number;
  sessions: number;
}

export interface StaffAdminRow {
  staffId: string;
  fullName: string;
  roles: string[];
  primaryDepartment: string;
  departmentAccess: string[];
  clinicalWriteScope: string;
  financialAccess: string;
  status: string;
}

export interface ToolsCapabilities {
  dailyRegister: boolean;
  treatmentHistory: boolean;
  salaryHistory: boolean;
  reportLibrary: boolean;
  reportUpload: boolean;
  caseStudy: boolean;
  caseStudyGenerate: boolean;
  clinicalAi: boolean;
  staffAi: boolean;
  learning: boolean;
  audit: boolean;
  corrections: boolean;
  settings: boolean;
  inventory: boolean;
  inventoryWrite: boolean;
}

export interface ParitySnapshot {
  date: string;
  capabilities: ToolsCapabilities;
  dailyRegister: {
    rows: DailyRegisterRow[];
    totalPaid: number;
    totalDue: number;
    totalDiscount: number;
    totalSessions: number;
  };
  treatments: TreatmentHistoryRow[];
  salaries: SalaryHistoryRow[];
  reports: PatientReportRow[];
  caseStudies: CaseStudyRow[];
  learning: LearningRow[];
  audit: AuditRow[];
  deleteLog: DeleteLogRow[];
  staff: StaffAdminRow[];
  visiblePatients: Array<{ patientId: string; fullName: string }>;
  integrations: {
    aiConfigured: boolean;
    driveUploadConfigured: boolean;
    telegramLegacyReportsPresent: boolean;
  };
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function number(value: unknown): number {
  const parsed = Number(normalize(value).replace(/[৳,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerIndex(headers: string[], name: string): number {
  const needle = name.toLowerCase();
  return headers.findIndex((header) => normalized(header) === needle);
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function todayDhaka(ref = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(value: string | undefined): string {
  const candidate = normalize(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : todayDhaka();
}

function isPhysio(row: string[], headers: string[]): boolean {
  const idx = headerIndex(headers, "Department");
  return idx >= 0 && at(row, idx) === "Physio";
}

function parsePatients(rows: string[][]): Array<{ patientId: string; fullName: string }> {
  if (rows.length < 2) return [];
  const h = rows[0];
  const id = headerIndex(h, "Patient_ID");
  const name = headerIndex(h, "Full_Name");
  const dept = headerIndex(h, "Department");
  const status = headerIndex(h, "Status");
  return rows.slice(1).flatMap((row) => {
    if (at(row, dept) !== "Physio") return [];
    if (at(row, status).toLowerCase() === "inactive") return [];
    const patientId = at(row, id);
    if (!patientId) return [];
    return [{ patientId, fullName: at(row, name) || patientId }];
  });
}

function parseDailyRegister(rows: string[][], date: string) {
  if (rows.length < 2) {
    return { rows: [], totalPaid: 0, totalDue: 0, totalDiscount: 0, totalSessions: 0 };
  }
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  const result: DailyRegisterRow[] = [];
  for (const row of rows.slice(1)) {
    if (!isPhysio(row, h) || at(row, idx("Date")) !== date) continue;
    const remarks = at(row, idx("Remarks"));
    const sessionsMatch = /Sessions:\s*(\d+)/i.exec(remarks);
    const serviceMatch = /Service:\s*([^|]+)/i.exec(remarks);
    const amount = number(at(row, idx("Amount")));
    const due = number(at(row, idx("Due")));
    result.push({
      receiptNo: at(row, idx("Receipt_No")),
      sl: at(row, idx("SL")),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      sessions: sessionsMatch ? Number(sessionsMatch[1]) : 1,
      service: serviceMatch?.[1]?.trim() || at(row, idx("Session_Type")),
      amount,
      discount: number(at(row, idx("Discount"))),
      due,
      paymentMethod: at(row, idx("Payment_Method")),
      receivedBy: at(row, idx("Received_By")),
      status: due <= 0 ? "Paid" : amount > 0 ? "Partial" : "Due",
    });
  }
  return {
    rows: result,
    totalPaid: result.reduce((sum, row) => sum + row.amount, 0),
    totalDue: totalLatestPatientDue(result),
    totalDiscount: result.reduce((sum, row) => sum + row.discount, 0),
    totalSessions: result.reduce((sum, row) => sum + row.sessions, 0),
  };
}

function parseTreatments(rows: string[][]): TreatmentHistoryRow[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (!isPhysio(row, h)) return [];
    const treatmentId = at(row, idx("Treatment_ID"));
    if (!treatmentId) return [];
    return [{
      treatmentId,
      date: at(row, idx("Date")),
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      diagnosis: at(row, idx("Diagnosis")),
      sessionNo: number(at(row, idx("Session_No"))),
      therapist: at(row, idx("Therapist")),
      treatmentGiven: at(row, idx("Treatment_Given")),
      painBefore: at(row, idx("Pain_Before")) || at(row, idx("Pain")),
      painAfter: at(row, idx("Pain_After")),
      response: at(row, idx("Response")),
      modification: at(row, idx("Modification")),
    }];
  }).reverse().slice(0, 60);
}

function parseSalary(rows: string[][]): SalaryHistoryRow[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (!isPhysio(row, h)) return [];
    const paymentId = at(row, idx("Payment_ID"));
    if (!paymentId) return [];
    return [{
      paymentId,
      date: at(row, idx("Date")),
      month: at(row, idx("Month")),
      staffId: at(row, idx("Staff_ID")),
      amount: number(at(row, idx("Amount"))),
      paidBy: at(row, idx("Paid_By")),
      note: at(row, idx("Note")),
      paidFrom: at(row, idx("Paid_From")),
      status: at(row, idx("Status")),
    }];
  }).reverse().slice(0, 60);
}

function parseReports(
  rows: string[][],
  physioPatientIds: Set<string>
): PatientReportRow[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  const deptIdx = idx("Department");
  return rows.slice(1).flatMap((row) => {
    const patientId = at(row, idx("Patient_ID"));
    const department = at(row, deptIdx);
    if (!physioPatientIds.has(patientId)) return [];
    if (department && department !== "Physio") return [];
    const reportId = at(row, idx("Report_ID"));
    if (!reportId) return [];
    return [{
      reportId,
      patientId,
      patientName: at(row, idx("Patient_Name")),
      fileName: at(row, idx("File_Name")),
      fileType: at(row, idx("File_Type")),
      uploadDate: at(row, idx("Upload_Date")),
      uploadedBy: at(row, idx("Uploaded_By")),
      driveLink: at(row, idx("File_Drive_Link")),
      legacyTelegramFileId: at(row, idx("File_Telegram_ID")),
    }];
  }).reverse().slice(0, 60);
}

function parseCaseStudies(
  rows: string[][],
  physioPatientIds: Set<string>
): CaseStudyRow[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const patientId = at(row, idx("Patient_ID"));
    if (!physioPatientIds.has(patientId)) return [];
    const caseStudyId = at(row, idx("Case_Study_ID"));
    if (!caseStudyId) return [];
    return [{
      caseStudyId,
      sessionId: at(row, idx("Session_ID")),
      patientId,
      patientName: at(row, idx("Patient_Name")),
      lessonNumber: number(at(row, idx("Lesson_Number"))),
      lessonTitle: at(row, idx("Lesson_Title")),
      content: at(row, idx("Content")),
      createdBy: at(row, idx("Created_By")),
      timestamp: at(row, idx("Timestamp")),
    }];
  }).reverse().slice(0, 30);
}

function parseLearning(
  rows: string[][],
  context: AccessContext,
  physioStaffIds: Set<string>
): LearningRow[] {
  if (rows.length < 2) return [];
  const canReadTeam = canPerform(context, "attendance.read_team", "Physio");
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    const staffId = at(row, idx("Staff_ID"));
    if (!staffId || !physioStaffIds.has(staffId)) return [];
    if (!canReadTeam && staffId !== context.staffId) return [];
    return [{
      staffId,
      fullName: at(row, idx("Full_Name")),
      role: at(row, idx("Role")),
      date: at(row, idx("Date")),
      type: at(row, idx("Type")),
      itemId: at(row, idx("Item_ID")),
      category: at(row, idx("Category")),
      selectedAnswer: at(row, idx("Selected_Answer")),
      correct: at(row, idx("Correct")),
      timestamp: at(row, idx("Timestamp")),
    }];
  }).reverse().slice(0, 50);
}

function parseAudit(rows: string[][]): AuditRow[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (!isPhysio(row, h)) return [];
    const auditId = at(row, idx("Audit_ID"));
    if (!auditId) return [];
    return [{
      auditId,
      timestamp: at(row, idx("Timestamp")),
      actorId: at(row, idx("Actor_ID")),
      action: at(row, idx("Action")),
      entityType: at(row, idx("Entity_Type")),
      entityId: at(row, idx("Entity_ID")),
      patientId: at(row, idx("Patient_ID")),
      beforeValue: at(row, idx("Before_Value")),
      afterValue: at(row, idx("After_Value")),
      reason: at(row, idx("Reason")),
    }];
  }).reverse().slice(0, 60);
}

function parseDeleteLog(rows: string[][]): DeleteLogRow[] {
  if (rows.length < 2) return [];
  const h = rows[0];
  const idx = (name: string) => headerIndex(h, name);
  return rows.slice(1).flatMap((row) => {
    if (!isPhysio(row, h)) return [];
    const receiptNo = at(row, idx("Receipt_No"));
    if (!receiptNo) return [];
    return [{
      timestamp: at(row, idx("Timestamp")),
      deletedBy: at(row, idx("Deleted_By")),
      type: at(row, idx("Type")),
      receiptNo,
      patientId: at(row, idx("Patient_ID")),
      patientName: at(row, idx("Patient_Name")),
      amount: number(at(row, idx("Amount"))),
      sessions: number(at(row, idx("Sessions"))),
    }];
  }).reverse().slice(0, 40);
}

function capability(context: AccessContext, action: Parameters<typeof canPerform>[1]) {
  return canPerform(context, action, "Physio");
}

export async function getParitySnapshot(
  context: AccessContext,
  requestedDate?: string
): Promise<ParitySnapshot> {
  const date = validDate(requestedDate);
  const capabilities: ToolsCapabilities = {
    dailyRegister: capability(context, "report.read_operational"),
    treatmentHistory: capability(context, "clinical.read"),
    salaryHistory: capability(context, "salary.read"),
    reportLibrary: capability(context, "clinical.read"),
    reportUpload: canPerform(context, "clinical.write", "Physio", { assignedToCurrentStaff: true }),
    caseStudy: capability(context, "clinical.read"),
    caseStudyGenerate: canPerform(context, "clinical.write", "Physio", { assignedToCurrentStaff: true }),
    clinicalAi: capability(context, "clinical.read"),
    staffAi: context.roles.includes("Owner"),
    learning: capability(context, "attendance.self") || capability(context, "attendance.read_team"),
    audit: capability(context, "audit.read"),
    corrections: capability(context, "payment.void"),
    settings: capability(context, "settings.manage"),
    inventory: capability(context, "inventory.read"),
    inventoryWrite: capability(context, "inventory.write"),
  };

  const ranges = new Set<string>(["02_Patients", "08_Staff"]);
  if (capabilities.dailyRegister || capabilities.corrections) ranges.add("06_Payments");
  if (capabilities.treatmentHistory || capabilities.clinicalAi || capabilities.caseStudy) ranges.add("05_Treatments");
  if (capabilities.salaryHistory) ranges.add("13_Salary");
  if (capabilities.reportLibrary || capabilities.reportUpload) ranges.add("14_Reports");
  if (capabilities.caseStudy) ranges.add("15_Case_Studies");
  if (capabilities.learning) ranges.add("18_Learning_Progress");
  if (capabilities.audit) ranges.add("20_Data_Audit");
  if (capabilities.corrections || capabilities.audit) ranges.add("16_Delete_Log");

  const [snapshot, directory] = await Promise.all([
    fetchSheetRanges("physio", [...ranges]),
    capabilities.settings || capabilities.salaryHistory || capabilities.learning
      ? getWebStaffDirectory()
      : Promise.resolve([]),
  ]);

  const canReadPatients = capability(context, "patient.read");
  const visiblePatients = canReadPatients
    ? parsePatients(snapshot["02_Patients"] || [])
    : [];
  const physioPatientIds = new Set(visiblePatients.map((patient) => patient.patientId));
  const physioStaff = directory.filter(
    (staff) =>
      staff.departmentAccess.includes("Physio") || staff.departmentAccess.includes("All")
  );
  const physioStaffIds = new Set(physioStaff.map((staff) => staff.staffId));

  const dailyRegister = capabilities.dailyRegister || capabilities.corrections
    ? parseDailyRegister(snapshot["06_Payments"] || [], date)
    : { rows: [], totalPaid: 0, totalDue: 0, totalDiscount: 0, totalSessions: 0 };
  const reports = capabilities.reportLibrary
    ? parseReports(snapshot["14_Reports"] || [], physioPatientIds)
    : [];

  return {
    date,
    capabilities,
    dailyRegister,
    treatments: capabilities.treatmentHistory
      ? parseTreatments(snapshot["05_Treatments"] || [])
      : [],
    salaries: capabilities.salaryHistory
      ? parseSalary(snapshot["13_Salary"] || [])
      : [],
    reports,
    caseStudies: capabilities.caseStudy
      ? parseCaseStudies(snapshot["15_Case_Studies"] || [], physioPatientIds)
      : [],
    learning: capabilities.learning
      ? parseLearning(snapshot["18_Learning_Progress"] || [], context, physioStaffIds)
      : [],
    audit: capabilities.audit ? parseAudit(snapshot["20_Data_Audit"] || []) : [],
    deleteLog: capabilities.corrections || capabilities.audit
      ? parseDeleteLog(snapshot["16_Delete_Log"] || [])
      : [],
    staff: capabilities.settings
      ? physioStaff.map((staff) => ({
          staffId: staff.staffId,
          fullName: staff.fullName,
          roles: staff.roles,
          primaryDepartment: staff.primaryDepartment || "",
          departmentAccess: staff.departmentAccess,
          clinicalWriteScope: staff.clinicalWriteScope,
          financialAccess: staff.financialAccess,
          status: staff.status,
        }))
      : [],
    visiblePatients,
    integrations: {
      aiConfigured: Boolean(process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY),
      driveUploadConfigured: Boolean(
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
          process.env.GOOGLE_CREDENTIALS_JSON ||
          ((process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL) &&
            (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY))
      ),
      telegramLegacyReportsPresent: reports.some(
        (report) => Boolean(report.legacyTelegramFileId) && !report.driveLink
      ),
    },
  };
}
