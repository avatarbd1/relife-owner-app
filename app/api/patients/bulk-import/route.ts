import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/csv";
import { invalidatePatientsCache } from "@/lib/patients";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { consumePhysioInventorySystem } from "@/lib/webos/inventory";
import { withMutationLock } from "@/lib/webos/mutationLock";
import { registerPatient } from "@/lib/webos/reception";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 500;

type Department = "Physio" | "Dental";

type ImportError = { row: number; error: string };

function key(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedGender(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "male" || lower === "m") return "Male";
  if (lower === "female" || lower === "f") return "Female";
  return value.trim();
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "PATIENT_IMPORT_FAILED";
  if (message.startsWith("DUPLICATE_PHONE:")) {
    const existing = message.split(":")[1] || "";
    return existing ? `Duplicate phone (existing ${existing})` : "Duplicate phone";
  }
  return message;
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ message: "Origin rejected" }, { status: 403 });
  }

  try {
    const context = await requireCurrentAccessContext();
    const formData = await request.formData();
    const value = formData.get("file");
    if (!(value instanceof File)) {
      return NextResponse.json({ message: "CSV file is required" }, { status: 400 });
    }
    if (value.size < 1 || value.size > MAX_FILE_BYTES) {
      return NextResponse.json({ message: "CSV must be between 1 byte and 2 MB" }, { status: 400 });
    }
    if (!value.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ message: "Only .csv files are supported" }, { status: 400 });
    }

    const rows = parseCsv(await value.text());
    if (rows.length < 2) {
      return NextResponse.json({ message: "CSV has no patient rows" }, { status: 400 });
    }
    if (rows.length - 1 > MAX_ROWS) {
      return NextResponse.json({ message: `Maximum ${MAX_ROWS} patient rows per import` }, { status: 400 });
    }

    const headers = rows[0].map(key);
    const index = (name: string) => headers.indexOf(key(name));
    const fullNameIdx = index("fullName");
    const departmentIdx = index("department");
    if (fullNameIdx < 0 || departmentIdx < 0) {
      return NextResponse.json(
        { message: "Required columns: fullName, department" },
        { status: 400 }
      );
    }

    const phoneIdx = index("phone");
    const alternativePhoneIdx = index("alternativePhone");
    const ageIdx = index("age");
    const genderIdx = index("gender");
    const addressIdx = index("address");
    const therapistIdx = Math.max(index("therapist"), index("therapistName"));
    const fatherHusbandIdx = index("fatherHusbandName");
    const diagnosisIdx = index("diagnosis");
    const referralIdx = index("referral");
    const remarksIdx = index("remarks");

    const errors: ImportError[] = [];
    let success = 0;
    let failed = 0;

    for (let offset = 1; offset < rows.length; offset += 1) {
      const csvRowNumber = offset + 1;
      const row = rows[offset];
      const at = (idx: number) => (idx >= 0 ? text(row[idx]) : "");
      const fullName = at(fullNameIdx);
      const rawDepartment = at(departmentIdx);
      const department: Department | null =
        rawDepartment.toLowerCase() === "physio"
          ? "Physio"
          : rawDepartment.toLowerCase() === "dental"
            ? "Dental"
            : null;

      if (!fullName) {
        failed += 1;
        errors.push({ row: csvRowNumber, error: "Missing fullName" });
        continue;
      }
      if (!department) {
        failed += 1;
        errors.push({ row: csvRowNumber, error: "Department must be Physio or Dental" });
        continue;
      }
      if (!canPerform(context, "patient.create", department)) {
        failed += 1;
        errors.push({ row: csvRowNumber, error: `No patient.create access for ${department}` });
        continue;
      }

      const gender = normalizedGender(at(genderIdx));
      if (department === "Physio" && !["Male", "Female"].includes(gender)) {
        failed += 1;
        errors.push({ row: csvRowNumber, error: "Physio gender must be Male or Female" });
        continue;
      }
      if (gender && !["Male", "Female"].includes(gender)) {
        failed += 1;
        errors.push({ row: csvRowNumber, error: "Gender must be Male or Female when provided" });
        continue;
      }

      try {
        await withMutationLock(`patient-register:${department}`, () =>
          registerPatient(context, {
            department,
            fullName,
            fatherHusbandName: at(fatherHusbandIdx) || undefined,
            phone: at(phoneIdx) || undefined,
            alternativePhone: at(alternativePhoneIdx) || undefined,
            age: at(ageIdx) || undefined,
            gender: gender || undefined,
            address: at(addressIdx) || undefined,
            diagnosis: at(diagnosisIdx) || undefined,
            therapist: at(therapistIdx) || undefined,
            referral: at(referralIdx) || undefined,
            remarks: at(remarksIdx) || undefined,
          })
        );
        success += 1;

        if (department === "Physio") {
          try {
            await consumePhysioInventorySystem(["Patient Card"], context.staffId, "Auto-Registration");
          } catch (inventoryError) {
            console.error("Bulk-import patient saved but inventory consumption failed", inventoryError);
          }
        }
      } catch (error) {
        failed += 1;
        errors.push({ row: csvRowNumber, error: errorMessage(error) });
      }
    }

    if (success > 0) invalidatePatientsCache();
    return NextResponse.json({ success, failed, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk import failed";
    if (message === "CSV_UNCLOSED_QUOTE") {
      return NextResponse.json({ message: "CSV contains an unclosed quoted field" }, { status: 400 });
    }
    console.error("Bulk patient import failed", error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
