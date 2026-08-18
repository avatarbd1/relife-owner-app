import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { canPerform } from "@/lib/webos/access";

export async function POST(request: NextRequest) {
  try {
    const context = await requireCurrentAccessContext();

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.trim().split("\n");

    if (lines.length < 2) {
      return NextResponse.json({ message: "CSV file is empty" }, { status: 400 });
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const requiredFields = ["fullname", "department"];

    for (const field of requiredFields) {
      if (!headers.includes(field)) {
        return NextResponse.json(
          { message: `Missing required column: ${field}` },
          { status: 400 }
        );
      }
    }

    const fullNameIdx = headers.indexOf("fullname");
    const departmentIdx = headers.indexOf("department");
    const phoneIdx = headers.indexOf("phone");
    const emailIdx = headers.indexOf("email");
    const ageIdx = headers.indexOf("age");
    const genderIdx = headers.indexOf("gender");
    const addressIdx = headers.indexOf("address");
    const therapistIdx = headers.indexOf("therapistname");

    const results = { success: 0, failed: 0, errors: [] as any[] };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(",").map((v) => v.trim());

        const fullName = values[fullNameIdx];
        const department = values[departmentIdx] as "Physio" | "Dental";

        if (!fullName) {
          results.failed++;
          results.errors.push({ row: i + 1, error: "Missing patient name" });
          continue;
        }

        if (!["Physio", "Dental"].includes(department)) {
          results.failed++;
          results.errors.push({ row: i + 1, error: "Invalid department. Use 'Physio' or 'Dental'" });
          continue;
        }

        // Check permission
        if (!canPerform(context, "patient.create", department)) {
          results.failed++;
          results.errors.push({ row: i + 1, error: `No permission to create ${department} patients` });
          continue;
        }

        // Build patient object
        const patient: any = {
          fullName,
          department,
        };

        if (values[phoneIdx]) patient.phone = values[phoneIdx];
        if (values[emailIdx]) patient.email = values[emailIdx];
        if (values[ageIdx]) patient.age = parseInt(values[ageIdx], 10) || undefined;
        if (values[genderIdx]) patient.gender = values[genderIdx];
        if (values[addressIdx]) patient.address = values[addressIdx];
        if (values[therapistIdx]) patient.therapistName = values[therapistIdx];

        // TODO: Call actual patient creation API
        // For now, we're just validating the data
        // const response = await fetch("/api/patients", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify(patient),
        // });

        // if (!response.ok) throw new Error("Failed to create patient");

        results.success++;
      } catch (error) {
        results.failed++;
        const message = error instanceof Error ? error.message : "Unknown error";
        results.errors.push({ row: i + 1, error: message });
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk import failed";
    return NextResponse.json({ message }, { status: 500 });
  }
}
