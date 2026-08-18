"use client";

import { useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastContext";
import { haptic } from "@/lib/interactions";

interface PatientBulkImportClientProps {
  canImportPhysio: boolean;
  canImportDental: boolean;
}

interface PatientRow {
  fullName: string;
  phone?: string;
  email?: string;
  age?: number;
  gender?: "Male" | "Female";
  address?: string;
  department: "Physio" | "Dental";
  therapistName?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

const CSV_TEMPLATE = `fullName,phone,email,age,gender,address,department,therapistName
Md. Abdul Karim,01700000001,abdul@example.com,45,Male,"123 Street, Dhaka",Physio,Ahmed
Fatima Begum,01712345678,fatima@example.com,32,Female,"456 Avenue, Dhaka",Dental,Dr. Khan`;

export default function PatientBulkImportClient({ canImportPhysio, canImportDental }: PatientBulkImportClientProps) {
  const { addToast } = useToastContext();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<PatientRow[]>([]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith(".csv")) {
      addToast("Please select a CSV file", "error");
      return;
    }

    setFile(selectedFile);
    setResult(null);

    // Parse and preview
    const text = await selectedFile.text();
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

    const rows: PatientRow[] = [];
    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const row: any = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || "";
      });
      rows.push(row);
    }
    setPreview(rows);
  }

  async function handleImport() {
    if (!file) {
      addToast("Please select a CSV file", "error");
      return;
    }

    setBusy(true);
    haptic("tap");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/patients/bulk-import", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Import failed");
      }

      const data = await response.json();
      setResult(data);
      haptic("success");

      if (data.failed === 0) {
        addToast(`Successfully imported ${data.success} patients`, "success");
      } else {
        addToast(
          `Imported ${data.success}, failed ${data.failed}. See details below.`,
          data.failed > data.success ? "error" : "warning"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      addToast(message, "error");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "patient-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <InlineNotice tone="info">
        Upload a CSV file with patient data. Required columns: fullName, department. Optional: phone, email, age, gender, address, therapistName.
      </InlineNotice>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Patient bulk import">
        <div className="space-y-4">
          <div>
            <label htmlFor="patient-csv-file" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              CSV File *
            </label>
            <input
              id="patient-csv-file"
              type="file"
              aria-required="true"
              onChange={handleFileSelect}
              disabled={busy}
              accept=".csv"
              className="mt-2 block w-full text-sm text-slate-600 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
            />
            {file && (
              <p className="mt-2 text-xs text-slate-500">
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {preview.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Preview (first 5 rows):</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Department</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Phone</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Gender</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-3 py-2">{row.fullName}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={row.department === "Dental" ? "success" : "info"}>
                            {row.department}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{row.phone || "—"}</td>
                        <td className="px-3 py-2">{row.gender || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Download Template
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!file || busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {busy && <Spinner size="xs" className="border-white/30 border-t-white" />}
              {busy ? "Importing..." : "Import Patients"}
            </button>
          </div>
        </div>
      </section>

      {result && (
        <section className={`rounded-2xl border p-5 shadow-sm ${result.failed === 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <h3 className={`text-sm font-bold ${result.failed === 0 ? "text-emerald-900" : "text-amber-900"}`}>
            Import Complete
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[10px] text-slate-600">Successfully imported</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{result.success}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Failed / Skipped</p>
              <p className={`mt-1 text-2xl font-bold ${result.failed > 0 ? "text-red-700" : "text-emerald-700"}`}>
                {result.failed}
              </p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-4 rounded-lg bg-white p-3">
              <p className="text-xs font-semibold text-slate-700 mb-2">Errors:</p>
              <ul className="space-y-1 text-[10px] text-slate-600">
                {result.errors.slice(0, 10).map((err, i) => (
                  <li key={i}>
                    Row {err.row}: {err.error}
                  </li>
                ))}
                {result.errors.length > 10 && <li>... and {result.errors.length - 10} more errors</li>}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
