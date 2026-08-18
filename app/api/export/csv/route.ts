import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { canPerform } from "@/lib/webos/access";
import { getVisiblePatients } from "@/lib/webos/reception";
import { getSalaryPayments, getStaff } from "@/lib/data";

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

export async function GET(request: NextRequest) {
  try {
    const context = await requireCurrentAccessContext();
    const searchParams = request.nextUrl.searchParams;

    const types = (searchParams.get("types") || "").split(",").filter(Boolean);
    const department = (searchParams.get("department") || "All") as "Physio" | "Dental" | "All";
    const dateRange = searchParams.get("dateRange") || "all";
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
      // TODO: Fetch appointments data filtered by department and date
      // Use getAppointmentSnapshot or similar function
      csvParts.push(`Appointments\nappointmentId,date,time,patientId,patientName,department,therapist,status,remarks`);
    }

    // SESSIONS export
    if (types.includes("sessions")) {
      // TODO: Fetch treatment sessions from clinical data
      csvParts.push(`Treatment Sessions\nsessionId,date,patientId,patientName,department,therapist,assessment,plan,outcome`);
    }

    // PAYMENTS export
    if (types.includes("payments")) {
      // TODO: Fetch payment collection data filtered by department and date
      csvParts.push(`Payments\nreceiptNo,date,patientId,patientName,department,amount,discount,method,status`);
    }

    // EXPENSES export
    if (types.includes("expenses")) {
      // TODO: Fetch approved expenses filtered by department and date
      csvParts.push(`Expenses\nid,date,category,amount,department,requestedBy,status`);
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
