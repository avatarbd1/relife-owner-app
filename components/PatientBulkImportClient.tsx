"use client";

import { useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastProvider";
import { parseCsv } from "@/lib/csv";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

type PreviewRow = {
  fullName: string;
  phone: string;
  age: string;
  gender: string;
  department: string;
  therapist: string;
};

type ImportResult = {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
};

const TEMPLATE = [
  "fullName,phone,alternativePhone,age,gender,address,department,therapist,fatherHusbandName,diagnosis,referral,remarks",
  'Md. Abdul Karim,01700000001,,45,Male,"123 Street, Amtali",Physio,Ahmed,,Low back pain,Self,Imported from legacy file',
  'Fatima Begum,01712345678,,32,Female,"456 Road, Amtali",Dental,Dr. Khan,,,Referral clinic,',
].join("\r\n");

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function PatientBulkImportClient({
  canImportPhysio,
  canImportDental,
}: {
  canImportPhysio: boolean;
  canImportDental: boolean;
}) {
  const toast = useToastContext();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const allowedDepartments = [
    canImportPhysio ? "Physio" : "",
    canImportDental ? "Dental" : "",
  ].filter(Boolean).join(" + ");

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    setFile(null);
    setPreview([]);
    setResult(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file");
      return;
    }
    if (selected.size > 2 * 1024 * 1024) {
      toast.error("CSV must be 2 MB or smaller");
      return;
    }

    try {
      const rows = parseCsv(await selected.text());
      if (rows.length < 2) throw new Error("CSV has no patient rows");
      const headers = rows[0].map(headerKey);
      const idx = (name: string) => headers.indexOf(headerKey(name));
      const fullNameIdx = idx("fullName");
      const departmentIdx = idx("department");
      if (fullNameIdx < 0 || departmentIdx < 0) {
        throw new Error("Required columns: fullName, department");
      }
      const phoneIdx = idx("phone");
      const ageIdx = idx("age");
      const genderIdx = idx("gender");
      const therapistIdx = Math.max(idx("therapist"), idx("therapistName"));
      const shown = rows.slice(1, 6).map((row) => ({
        fullName: String(row[fullNameIdx] || "").trim(),
        department: String(row[departmentIdx] || "").trim(),
        phone: phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "",
        age: ageIdx >= 0 ? String(row[ageIdx] || "").trim() : "",
        gender: genderIdx >= 0 ? String(row[genderIdx] || "").trim() : "",
        therapist: therapistIdx >= 0 ? String(row[therapistIdx] || "").trim() : "",
      }));
      setFile(selected);
      setPreview(shown);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse CSV");
    }
  }

  async function importPatients() {
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    haptic("tap");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/patients/bulk-import", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Import failed");
      const next = payload as ImportResult;
      setResult(next);
      if (next.failed === 0) {
        toast.success(`Imported ${next.success} patient${next.success === 1 ? "" : "s"}`);
        haptic("success");
      } else if (next.success > 0) {
        toast.warning(`Imported ${next.success}; ${next.failed} row${next.failed === 1 ? "" : "s"} failed`);
        haptic("warning");
      } else {
        toast.error(`No patients imported; ${next.failed} row${next.failed === 1 ? "" : "s"} failed`);
        haptic("error");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "relife-patient-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <InlineNotice tone="info">
        Allowed department: {allowedDepartments || "None"}. Required columns are fullName and department. Physio rows require Male/Female gender. Maximum 500 rows and 2 MB per import.
      </InlineNotice>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Patient bulk import">
        <label htmlFor="patient-bulk-csv" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          CSV file
        </label>
        <input
          id="patient-bulk-csv"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={selectFile}
          className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700"
        />
        {file && <p className="mt-2 text-xs text-slate-500">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}

        {preview.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[620px] text-xs">
              <caption className="sr-only">First five rows from the selected patient CSV</caption>
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Age / gender</th><th className="px-3 py-2">Clinician</th></tr>
              </thead>
              <tbody>
                {preview.map((row, index) => (
                  <tr key={`${index}-${row.fullName}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.fullName || "—"}</td>
                    <td className="px-3 py-2"><StatusBadge tone={row.department === "Dental" ? "success" : row.department === "Physio" ? "info" : "warning"}>{row.department || "Missing"}</StatusBadge></td>
                    <td className="px-3 py-2 text-slate-600">{row.phone || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{[row.age, row.gender].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{row.therapist || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" onClick={downloadTemplate} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Download template
          </button>
          <button type="button" onClick={importPatients} disabled={!file || busy} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
            {busy && <Spinner size="sm" className="border-white/30 border-t-white" />}
            {busy ? "Importing…" : "Import patients"}
          </button>
        </div>
      </section>

      {result && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Imported</p><p className="mt-1 text-2xl font-bold text-emerald-900">{result.success}</p></div>
            <div className="rounded-lg bg-red-50 p-3"><p className="text-xs text-red-700">Failed / skipped</p><p className="mt-1 text-2xl font-bold text-red-900">{result.failed}</p></div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Row errors</p>
              <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-slate-600">
                {result.errors.map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.error}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
