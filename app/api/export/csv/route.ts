import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { canPerform } from "@/lib/webos/access";
import { getVisiblePatients, getAppointmentsForContext } from "@/lib/webos/reception";
import { getSalaryPayments, getStaff, getPayments, getExpenses } from "@/lib/data";
import { fetchSheetRanges } from "@/lib/data/googleSheets";

function escapeCSV(value: unknown): string {
  const str = String(value ?? "").trim();
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows: any[][], headers?: string[]): string {
  if (rows.length === 0) return "";

  if (!headers) {
    headers = Object.keys(rows[0]);
  }

  const lines: string[] = [headers.map(escapeCSV).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCSV(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

function getDateRange(dateRange: string, startDate: string, endDate: string): { start: Date; end: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start = new Date(today);
  let end = new Date(today);
  end.setHours(23, 59, 59, 999);

  switch (dateRange) {
    case "this-month":
      start.setDate(1);
      break;
    case "last-month":
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case "this-year":
      start.setMonth(0);
      start.setDate(1);
      break;
    case "custom":
      if (startDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      }
      break;
    case "all":
    default:
      start = new Date(1970, 0, 1);
      end = new Date(2100, 0, 1);
      break;
  }

  return { start, end };
}

function matchesDateRange(dateStr: string, dateRange: { start: Date; end: Date }): boolean {
  const date = new Date(dateStr);
  return date >= dateRange.start && date <= dateRange.end;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireCurrentAccessContext();
    const searchParams = request.nextUrl.searchParams;

    const types = (searchParams.get("types") || "").split(",").filter(Boolean);
    const department = (searchParams.get("department") || "All") as "Physio" | "Dental" | "All";
    const dateRangeType = searchParams.get("dateRange") || "all";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";

    if (types.length === 0) {
      return NextResponse.json({ message: "No export types specified" }, { status: 400 });
    }

    // Permission checks
    const scopedDepts = ["Physio", "Dental"].filter((d) =>
      canPerform(context, "patient.read", d as "Physio" | "Dental")
    );

    if (scopedDepts.length === 0) {
      return NextResponse.json({ message: "No data export permission" }, { status: 403 });
    }

    const csvParts: string[] = [];

    // PATIENTS export
    if (types.includes("patients")) {
      const patients = await getVisiblePatients(context, department === "All" ? "combined" : department === "Physio" ? "physio" : "dental");
      if (patients.length > 0) {
        const rows = patients.map((p) => ({
          patientId: p.patientId,
          fullName: p.fullName,
          phone: p.phone || "",
          email: p.email || "",
          age: p.age || "",
          gender: p.gender || "",
          department: p.department,
          therapist: p.therapist || "",
          registrationDate: p.registrationDate || "",
          status: p.status || "Active",
        }));
        csvParts.push(`Patient Registry\n${toCSV(rows)}`);
      }
    }

    // APPOINTMENTS export
    if (types.includes("appointments")) {
      const appointmentScope = department === "All" ? "combined" : department === "Physio" ? "physio" : "dental";
      const appointments = await getAppointmentsForContext(context, appointmentScope);
      const dateRange = getDateRange(dateRangeType, startDate, endDate);
      const filteredAppointments = appointments.filter((apt) => matchesDateRange(apt.date, dateRange));

      if (filteredAppointments.length > 0) {
        const rows = filteredAppointments.map((apt) => ({
          appointmentId: apt.appointmentId,
          date: apt.date,
          time: apt.time,
          patientId: apt.patientId,
          patientName: apt.patientName,
          department: apt.department,
          therapist: apt.therapist,
          status: apt.status,
          remarks: apt.remarks || "",
        }));
        csvParts.push(`Appointments\n${toCSV(rows)}`);
      }
    }

    // SESSIONS export
    if (types.includes("sessions")) {
      const treatmentSheets = await Promise.all([
        department !== "Dental" ? fetchSheetRanges("physio", ["05_Treatments"]) : Promise.resolve({}),
        department !== "Physio" ? fetchSheetRanges("dental", ["05_Treatments"]) : Promise.resolve({}),
      ]);

      const dateRange = getDateRange(dateRangeType, startDate, endDate);
      const sessions: any[] = [];

      // Parse Physio treatments if applicable
      if (department !== "Dental" && treatmentSheets[0]["05_Treatments"]) {
        const rows = treatmentSheets[0]["05_Treatments"];
        if (rows.length > 1) {
          const headers = rows[0];
          const dateIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("date"));
          const patientIdIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("patient") && String(h || "").toLowerCase().includes("id"));
          const patientNameIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("patient") && String(h || "").toLowerCase().includes("name"));
          const therapistIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("therapist"));
          const assessmentIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("assessment"));
          const planIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("plan"));
          const outcomeIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("outcome"));
          const notesIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("notes"));

          for (let i = 1; i < rows.length; i++) {
            const date = dateIdx >= 0 ? String(rows[i][dateIdx] || "").trim() : "";
            if (date && matchesDateRange(date, dateRange)) {
              sessions.push({
                sessionId: `PHYSIO_${i}`,
                date,
                patientId: patientIdIdx >= 0 ? String(rows[i][patientIdIdx] || "").trim() : "",
                patientName: patientNameIdx >= 0 ? String(rows[i][patientNameIdx] || "").trim() : "",
                department: "Physio",
                therapist: therapistIdx >= 0 ? String(rows[i][therapistIdx] || "").trim() : "",
                assessment: assessmentIdx >= 0 ? String(rows[i][assessmentIdx] || "").trim() : "",
                plan: planIdx >= 0 ? String(rows[i][planIdx] || "").trim() : "",
                outcome: outcomeIdx >= 0 ? String(rows[i][outcomeIdx] || "").trim() : "",
                notes: notesIdx >= 0 ? String(rows[i][notesIdx] || "").trim() : "",
              });
            }
          }
        }
      }

      // Parse Dental treatments if applicable
      if (department !== "Physio" && treatmentSheets[1]["05_Treatments"]) {
        const rows = treatmentSheets[1]["05_Treatments"];
        if (rows.length > 1) {
          const headers = rows[0];
          const dateIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("date"));
          const patientIdIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("patient") && String(h || "").toLowerCase().includes("id"));
          const patientNameIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("patient") && String(h || "").toLowerCase().includes("name"));
          const dentistIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("dentist"));
          const assessmentIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("assessment"));
          const planIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("plan"));
          const outcomeIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("outcome"));
          const notesIdx = headers.findIndex((h) => String(h || "").toLowerCase().includes("notes"));

          for (let i = 1; i < rows.length; i++) {
            const date = dateIdx >= 0 ? String(rows[i][dateIdx] || "").trim() : "";
            if (date && matchesDateRange(date, dateRange)) {
              sessions.push({
                sessionId: `DENTAL_${i}`,
                date,
                patientId: patientIdIdx >= 0 ? String(rows[i][patientIdIdx] || "").trim() : "",
                patientName: patientNameIdx >= 0 ? String(rows[i][patientNameIdx] || "").trim() : "",
                department: "Dental",
                therapist: dentistIdx >= 0 ? String(rows[i][dentistIdx] || "").trim() : "",
                assessment: assessmentIdx >= 0 ? String(rows[i][assessmentIdx] || "").trim() : "",
                plan: planIdx >= 0 ? String(rows[i][planIdx] || "").trim() : "",
                outcome: outcomeIdx >= 0 ? String(rows[i][outcomeIdx] || "").trim() : "",
                notes: notesIdx >= 0 ? String(rows[i][notesIdx] || "").trim() : "",
              });
            }
          }
        }
      }

      if (sessions.length > 0) {
        csvParts.push(`Treatment Sessions\n${toCSV(sessions)}`);
      }
    }

    // PAYMENTS export
    if (types.includes("payments")) {
      const allPayments = await getPayments();
      const dateRange = getDateRange(dateRangeType, startDate, endDate);
      const filteredPayments = allPayments.filter(
        (p) => (department === "All" || p.department === department) && matchesDateRange(p.date, dateRange)
      );

      if (filteredPayments.length > 0) {
        const rows = filteredPayments.map((p) => ({
          receiptNo: p.receiptNo,
          date: p.date,
          patientId: p.patientId,
          patientName: p.patientName,
          department: p.department,
          amount: p.amount,
          discount: p.discount,
          due: p.due,
          paymentMethod: p.paymentMethod,
          receivedBy: p.receivedBy,
          remarks: p.remarks || "",
        }));
        csvParts.push(`Payments\n${toCSV(rows)}`);
      }
    }

    // EXPENSES export
    if (types.includes("expenses")) {
      const allExpenses = await getExpenses();
      const dateRange = getDateRange(dateRangeType, startDate, endDate);
      const filteredExpenses = allExpenses.filter(
        (e) =>
          (department === "All" || e.department === department) &&
          matchesDateRange(e.date, dateRange) &&
          e.status?.toLowerCase() === "approved"
      );

      if (filteredExpenses.length > 0) {
        const rows = filteredExpenses.map((e) => ({
          expenseId: e.expenseId,
          date: e.date,
          category: e.category,
          amount: e.amount,
          department: e.department,
          requestedBy: e.paidBy,
          paymentMethod: e.paymentMethod,
          status: e.status || "Approved",
          description: e.description,
          paidFrom: e.paidFrom || "",
        }));
        csvParts.push(`Expenses\n${toCSV(rows)}`);
      }
    }

    // SALARY export
    if (types.includes("salary")) {
      const salaryData = await getSalaryPayments();
      const staff = await getStaff();

      // Filter by department if specified
      const filteredSalary = salaryData.filter(row =>
        department === "All" || row.department === department
      );

      if (filteredSalary.length > 0) {
        const rows = filteredSalary.map((s) => ({
          staffId: s.staffId,
          staffName: s.staffName,
          department: s.department,
          amount: s.amount,
          type: s.type,
          paidFrom: s.paidFrom,
          status: s.status,
          date: s.date,
        }));
        csvParts.push(`Salary Payments\n${toCSV(rows)}`);
      }
    }

    // Combine all CSV parts
    const fullCSV = csvParts.join("\n\n");

    // Return as CSV download
    return new NextResponse(fullCSV, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="export-${new Date().toISOString().split("T")[0]}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    console.error("CSV export error:", error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
