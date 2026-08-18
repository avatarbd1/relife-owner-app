"use client";

import { useMemo, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastProvider";
import { haptic } from "@/lib/interactions";

type ExportType = "patients" | "appointments" | "sessions" | "payments" | "expenses" | "salary";
type Department = "Physio" | "Dental" | "All";

const OPTIONS: Record<ExportType, { label: string; description: string }> = {
  patients: { label: "Patients", description: "Patient registry and assignments" },
  appointments: { label: "Appointments", description: "Schedule, clinician and status" },
  sessions: { label: "Treatment sessions", description: "Clinical treatment session history" },
  payments: { label: "Payments", description: "Financial collection ledger" },
  expenses: { label: "Expenses", description: "Approved or paid clinic expenses" },
  salary: { label: "Salary payments", description: "Staff salary payment history" },
};

export default function CsvExportClient({
  allowedTypes,
  allowedDepartments,
}: {
  allowedTypes: ExportType[];
  allowedDepartments: Array<"Physio" | "Dental">;
}) {
  const toast = useToastContext();
  const departmentOptions = useMemo<Department[]>(
    () => allowedDepartments.length > 1 ? ["All", ...allowedDepartments] : [...allowedDepartments],
    [allowedDepartments]
  );
  const [selected, setSelected] = useState<Set<ExportType>>(() => new Set(allowedTypes.slice(0, 1)));
  const [department, setDepartment] = useState<Department>(departmentOptions[0] || "All");
  const [dateRange, setDateRange] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(type: ExportType) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function exportCsv() {
    if (selected.size === 0 || busy) return;
    if (dateRange === "custom" && (!startDate || !endDate || startDate > endDate)) {
      toast.error("Select a valid custom date range");
      return;
    }
    setBusy(true);
    haptic("tap");
    try {
      const params = new URLSearchParams({
        types: [...selected].join(","),
        department,
        dateRange,
      });
      if (dateRange === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      const response = await fetch(`/api/export/csv?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relife-export-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("CSV export created");
      haptic("success");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="export-types-title">
        <h2 id="export-types-title" className="text-sm font-semibold text-slate-900">Data sets</h2>
        <p className="mt-1 text-xs text-slate-500">Only data sets permitted by your server-side role are available.</p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {allowedTypes.map((type) => (
            <label key={type} className={`cursor-pointer rounded-xl border p-3 ${selected.has(type) ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(type)} onChange={() => toggle(type)} disabled={busy} className="mt-1" />
                <div><p className="text-sm font-semibold text-slate-900">{OPTIONS[type].label}</p><p className="mt-0.5 text-xs text-slate-500">{OPTIONS[type].description}</p></div>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="export-filters-title">
        <h2 id="export-filters-title" className="text-sm font-semibold text-slate-900">Filters</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="export-department" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department</label>
            <select id="export-department" value={department} onChange={(event) => setDepartment(event.target.value as Department)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
              {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="export-range" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date range</label>
            <select id="export-range" value={dateRange} onChange={(event) => setDateRange(event.target.value)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
              <option value="all">All time</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="this-year">This year</option><option value="custom">Custom</option>
            </select>
          </div>
        </div>
        {dateRange === "custom" && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="export-start" className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</label><input id="export-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></div>
            <div><label htmlFor="export-end" className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</label><input id="export-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></div>
          </div>
        )}
      </section>

      <button type="button" onClick={exportCsv} disabled={busy || selected.size === 0} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
        {busy && <Spinner size="sm" className="border-white/30 border-t-white" />}
        {busy ? "Exporting…" : `Export ${selected.size} data set${selected.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
