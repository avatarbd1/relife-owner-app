import { NextRequest, NextResponse } from "next/server";
import { objectsToCsv } from "@/lib/csv";
import { getExpenses, getPayments, getSalaryPayments } from "@/lib/data";
import { fetchSheetRanges, type Workbook } from "@/lib/data/googleSheets";
import { assertValidDateRange, isValidIsoDate } from "@/lib/domain/finance/dateRange";
import { canPerform, type AccessContext, type WebAction } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { getAppointmentsForContext, getVisiblePatients, todayDhaka } from "@/lib/webos/reception";
import { isRelifeLegacyTenant } from "@/lib/config/relifeSystem";

const EXPORT_TYPES = ["patients", "appointments", "sessions", "payments", "expenses", "salary"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];
type Department = "Physio" | "Dental";

type DateRange = { start: string; end: string } | null;

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function requestedDepartments(value: string): Department[] {
  if (value === "Physio") return ["Physio"];
  if (value === "Dental") return ["Dental"];
  return ["Physio", "Dental"];
}

function allowedDepartments(
  context: AccessContext,
  requested: Department[],
  actions: WebAction[]
): Department[] {
  return requested.filter((department) => actions.every((action) => canPerform(context, action, department)));
}

function scopeForDepartments(departments: Department[]): "combined" | "physio" | "dental" {
  if (departments.length === 2) return "combined";
  return departments[0] === "Dental" ? "dental" : "physio";
}

function isoDate(value: unknown): string {
  const text = normalize(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match && isValidIsoDate(match[1])) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function shiftMonth(dateKey: string, delta: number): { year: number; month: number } {
  const [year, month] = dateKey.split("-").map(Number);
  const ref = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: ref.getUTCFullYear(), month: ref.getUTCMonth() + 1 };
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function resolveDateRange(kind: string, startDate: string, endDate: string): DateRange {
  const today = todayDhaka();
  const [year, month] = today.split("-").map(Number);
  if (kind === "all") return null;
  if (kind === "this-month") return { start: `${year}-${pad(month)}-01`, end: today };
  if (kind === "last-month") {
    const previous = shiftMonth(today, -1);
    return {
      start: `${previous.year}-${pad(previous.month)}-01`,
      end: `${previous.year}-${pad(previous.month)}-${pad(lastDay(previous.year, previous.month))}`,
    };
  }
  if (kind === "this-year") return { start: `${year}-01-01`, end: today };
  if (kind === "custom") {
    assertValidDateRange(startDate, endDate);
    return { start: startDate, end: endDate };
  }
  throw new Error("INVALID_DATE_RANGE");
}

function inRange(value: unknown, range: DateRange): boolean {
  if (!range) return true;
  const key = isoDate(value);
  return Boolean(key && key >= range.start && key <= range.end);
}

function titleSection(title: string, csv: string): string {
  return `${title}\r\n${csv}`;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((value) => normalize(value).toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const name of names) {
    const index = normalized.indexOf(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

async function treatmentRows(department: Department, range: DateRange): Promise<Array<Record<string, unknown>>> {
  const workbook: Workbook = department === "Dental" ? "dental" : "physio";
  const snapshot = await fetchSheetRanges(workbook, ["05_Treatments"]);
  const rows = snapshot["05_Treatments"] || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Treatment_ID", "Session_ID");
  const dateIdx = headerIndex(headers, "Date", "Treatment_Date");
  const patientIdIdx = headerIndex(headers, "Patient_ID");
  const patientNameIdx = headerIndex(headers, "Patient_Name", "Full_Name");
  const clinicianIdx = headerIndex(headers, department === "Dental" ? "Dentist" : "Therapist", "Provider", "Clinician");
  const sessionNoIdx = headerIndex(headers, "Session_No", "Session");
  const assessmentIdx = headerIndex(headers, "Assessment", "Diagnosis");
  const planIdx = headerIndex(headers, "Plan", "Treatment_Given", "Exercise");
  const painBeforeIdx = headerIndex(headers, "Pain_Before", "Pain");
  const painAfterIdx = headerIndex(headers, "Pain_After");
  const responseIdx = headerIndex(headers, "Response", "Outcome");
  const remarksIdx = headerIndex(headers, "Remarks", "Notes", "Modification");

  return rows.slice(1).flatMap((row, index) => {
    const date = at(row, dateIdx);
    const patientId = at(row, patientIdIdx);
    if (!patientId || !date || !inRange(date, range)) return [];
    return [{
      sessionId: at(row, idIdx) || `${department.toUpperCase()}_${index + 2}`,
      date,
      patientId,
      patientName: at(row, patientNameIdx),
      department,
      clinician: at(row, clinicianIdx),
      sessionNo: at(row, sessionNoIdx),
      assessment: at(row, assessmentIdx),
      plan: at(row, planIdx),
      painBefore: at(row, painBeforeIdx),
      painAfter: at(row, painAfterIdx),
      response: at(row, responseIdx),
      remarks: at(row, remarksIdx),
    }];
  });
}

function permissionActions(type: ExportType): WebAction[] {
  if (type === "patients") return ["report.read_operational", "patient.read"];
  if (type === "appointments") return ["report.read_operational", "appointment.read"];
  if (type === "sessions") return ["report.read_operational", "clinical.read"];
  if (type === "salary") return ["report.read_financial", "salary.read"];
  return ["report.read_financial"];
}

export async function GET(request: NextRequest) {
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const legacyRelife = isRelifeLegacyTenant(tenantContext.tenant);
    const context = tenantContext.access;
    const params = request.nextUrl.searchParams;
    const rawTypes = (params.get("types") || "").split(",").filter(Boolean);
    const types = rawTypes.filter((value): value is ExportType => EXPORT_TYPES.includes(value as ExportType));
    if (types.length === 0 || types.length !== rawTypes.length) {
      return NextResponse.json({ message: "Select one or more valid export types" }, { status: 400 });
    }

    const requested = requestedDepartments(params.get("department") || "All");
    const range = resolveDateRange(
      params.get("dateRange") || "all",
      params.get("startDate") || "",
      params.get("endDate") || ""
    );
    const sections: string[] = [];

    for (const type of types) {
      const departments = allowedDepartments(context, requested, permissionActions(type));
      if (departments.length === 0) {
        return NextResponse.json({ message: `No authorized ${type} data in the requested department` }, { status: 403 });
      }

      if (type === "patients") {
        const patients = await getVisiblePatients(context, scopeForDepartments(departments), tenantContext.tenant.organizationId, tenantContext.tenant.clinicId);
        const rows = patients
          .filter((patient) => departments.includes(patient.department as Department) && inRange(patient.registrationDate, range))
          .map((patient) => ({
            patientId: patient.patientId,
            fullName: patient.fullName,
            phone: patient.phone,
            age: patient.age,
            gender: patient.gender,
            address: patient.address,
            department: patient.department,
            diagnosis: patient.diagnosis,
            clinician: patient.therapist,
            registrationDate: patient.registrationDate,
            status: patient.status,
          }));
        sections.push(titleSection("Patients", objectsToCsv(rows, ["patientId", "fullName", "phone", "age", "gender", "address", "department", "diagnosis", "clinician", "registrationDate", "status"])));
      }

      if (type === "appointments") {
        const appointments = await getAppointmentsForContext(context, scopeForDepartments(departments), undefined, tenantContext.tenant.organizationId, tenantContext.tenant.clinicId);
        const rows = appointments
          .filter((item) => departments.includes(item.department) && inRange(item.date, range))
          .map((item) => ({
            appointmentId: item.appointmentId,
            date: item.date,
            time: item.time,
            patientId: item.patientId,
            patientName: item.patientName,
            department: item.department,
            clinician: item.therapist,
            status: item.status,
            remarks: item.remarks,
          }));
        sections.push(titleSection("Appointments", objectsToCsv(rows, ["appointmentId", "date", "time", "patientId", "patientName", "department", "clinician", "status", "remarks"])));
      }

      if (type === "sessions") {
        const rows = legacyRelife
          ? (await Promise.all(departments.map((department) => treatmentRows(department, range)))).flat()
          : [];
        sections.push(titleSection("Treatment Sessions", objectsToCsv(rows, ["sessionId", "date", "patientId", "patientName", "department", "clinician", "sessionNo", "assessment", "plan", "painBefore", "painAfter", "response", "remarks"])));
      }

      if (type === "payments") {
        const rows = (await getPayments(tenantContext.tenant.organizationId, tenantContext.tenant.clinicId))
          .filter((item) => item.department !== "All" && departments.includes(item.department) && inRange(item.date, range))
          .map((item) => ({
            receiptNo: item.receiptNo,
            date: item.date,
            patientId: item.patientId,
            patientName: item.patientName,
            department: item.department,
            amount: item.amount,
            discount: item.discount,
            due: item.due,
            paymentMethod: item.paymentMethod,
            receivedBy: item.receivedBy,
            remarks: item.remarks || "",
          }));
        sections.push(titleSection("Payments", objectsToCsv(rows, ["receiptNo", "date", "patientId", "patientName", "department", "amount", "discount", "due", "paymentMethod", "receivedBy", "remarks"])));
      }

      if (type === "expenses") {
        const rows = (await getExpenses(tenantContext.tenant.organizationId, tenantContext.tenant.clinicId))
          .filter((item) => item.department !== "All" && departments.includes(item.department) && inRange(item.date, range) && ["approved", "paid"].includes(normalize(item.status).toLowerCase()))
          .map((item) => ({
            expenseId: item.expenseId,
            date: item.date,
            category: item.category,
            description: item.description,
            amount: item.amount,
            department: item.department,
            expenseType: item.expenseType,
            paidFrom: item.paidFrom || "",
            paidBy: item.paidBy,
            status: item.status,
          }));
        sections.push(titleSection("Expenses", objectsToCsv(rows, ["expenseId", "date", "category", "description", "amount", "department", "expenseType", "paidFrom", "paidBy", "status"])));
      }

      if (type === "salary") {
        const rows = (await getSalaryPayments(tenantContext.tenant.organizationId, tenantContext.tenant.clinicId))
          .filter((item) => item.department !== "All" && departments.includes(item.department) && inRange(item.date, range))
          .map((item) => ({
            paymentId: item.id,
            date: item.date,
            staffId: item.staffId,
            staffName: item.staffName,
            department: item.department,
            amount: item.amount,
            type: item.type,
            paidFrom: item.paidFrom,
            status: item.status,
          }));
        sections.push(titleSection("Salary Payments", objectsToCsv(rows, ["paymentId", "date", "staffId", "staffName", "department", "amount", "type", "paidFrom", "status"])));
      }
    }

    const csv = `\uFEFF${sections.join("\r\n\r\n")}`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relife-export-${todayDhaka()}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EXPORT_FAILED";
    if (message === "INVALID_DATE_RANGE") {
      return NextResponse.json({ message: "Invalid date range" }, { status: 400 });
    }
    console.error("CSV export failed", error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
