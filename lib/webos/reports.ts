import "server-only";

import { fetchSheetRanges, type Workbook } from "@/lib/data/googleSheets";
import type { PatientRecord } from "@/lib/patients";
import { canPerform, type AccessContext } from "@/lib/webos/access";

export type PatientReport = {
  reportId: string;
  patientId: string;
  patientName: string;
  fileName: string;
  fileType: string;
  uploadDate: string;
  uploadedBy: string;
  driveLink: string;
  department: "Physio" | "Dental";
};

function rowObjects(values: string[][]): Record<string, string>[] {
  if (values.length < 2) return [];
  const headers = values[0].map((value) => String(value || "").trim());
  return values.slice(1).map((row) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) object[header] = String(row[index] ?? "");
    });
    return object;
  });
}

function workbookForDepartment(department: "Physio" | "Dental"): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

export async function getPatientReportsForContext(
  context: AccessContext,
  patient: PatientRecord
): Promise<PatientReport[]> {
  if (patient.department !== "Physio" && patient.department !== "Dental") return [];
  const department: "Physio" | "Dental" = patient.department;
  if (!canPerform(context, "clinical.read", department)) return [];

  const workbook = workbookForDepartment(department);
  const data = await fetchSheetRanges(workbook, ["14_Reports"]);
  const rows = rowObjects(data["14_Reports"] || []);

  return rows
    .filter(
      (row) =>
        String(row.Patient_ID || "").trim() === patient.patientId &&
        String(row.Report_ID || "").trim()
    )
    .map((row) => ({
      reportId: String(row.Report_ID || "").trim(),
      patientId: String(row.Patient_ID || "").trim(),
      patientName: String(row.Patient_Name || "").trim(),
      fileName: String(row.File_Name || "").trim(),
      fileType: String(row.File_Type || "").trim(),
      uploadDate: String(row.Upload_Date || "").trim(),
      uploadedBy: String(row.Uploaded_By || "").trim(),
      driveLink: String(row.File_Drive_Link || "").trim(),
      department,
    }))
    .sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));
}

export async function getPatientReportForContext(
  context: AccessContext,
  patient: PatientRecord,
  reportId: string
): Promise<PatientReport | null> {
  const reports = await getPatientReportsForContext(context, patient);
  return reports.find((report) => report.reportId === reportId) || null;
}
