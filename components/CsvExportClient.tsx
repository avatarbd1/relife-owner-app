"use client";

import { useState } from "react";
import { Spinner, StatusBadge } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastContext";
import { haptic } from "@/lib/interactions";
import type { Scope } from "@/lib/types";

type ExportType = "patients" | "appointments" | "sessions" | "payments" | "expenses" | "salary";

interface CsvExportClientProps {
  scope: Scope;
  canExportPhysio: boolean;
  canExportDental: boolean;
}

const EXPORT_OPTIONS: Record<ExportType, { label: string; description: string; icon: string }> = {
  patients: {
    label: "Patients",
    description: "Patient registry with contact info, assignments, and status",
    icon: "👥",
  },
  appointments: {
    label: "Appointments",
    description: "All appointments with dates, times, clinician, and status",
    icon: "📅",
  },
  sessions: {
    label: "Treatment Sessions",
    description: "Clinical session records with assessments, plans, and outcomes",
    icon: "🏥",
  },
  payments: {
    label: "Payments",
    description: "Payment collection with amounts, discounts, and payment methods",
    icon: "💳",
  },
  expenses: {
    label: "Expenses",
    description: "Approved expense requests with dates, categories, and amounts",
    icon: "📊",
  },
  salary: {
    label: "Salary Payments",
    description: "Staff salary records with amounts, dates, and payment status",
    icon: "💰",
  },
};

export default function CsvExportClient({
  scope,
  canExportPhysio,
  canExportDental,
}: CsvExportClientProps) {
  const { addToast } = useToastContext();
  const [selectedTypes, setSelectedTypes] = useState<Set<ExportType>>(new Set(["patients"]));
  const [department, setDepartment] = useState<"Physio" | "Dental" | "All">("All");
  const [dateRange, setDateRange] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const getDepartmentOptions = () => {
    const options = [];
    if (canExportPhysio) options.push("Physio");
    if (canExportDental) options.push("Dental");
    if (options.length > 1) options.push("All");
    return options;
  };

  const handleToggleType = (type: ExportType) => {
    const newSet = new Set(selectedTypes);
    if (newSet.has(type)) {
      newSet.delete(type);
    } else {
      newSet.add(type);
    }
    setSelectedTypes(newSet);
  };

  const handleExport = async () => {
    if (selectedTypes.size === 0) {
      addToast("Please select at least one export type", "error");
      return;
    }

    if (dateRange === "custom" && (!startDate || !endDate)) {
      addToast("Please specify date range", "error");
      return;
    }

    setExporting(true);
    haptic("tap");

    try {
      const params = new URLSearchParams({
        types: Array.from(selectedTypes).join(","),
        department,
        dateRange,
        ...(dateRange === "custom" && { startDate, endDate }),
      });

      const response = await fetch(`/api/export/csv?${params.toString()}`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Download CSV file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      haptic("success");
      addToast("Data exported successfully", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      addToast(message, "error");
      haptic("error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Export type selection">
        <div className="mb-4">
          <p id="export-legend" className="text-sm font-semibold text-slate-900">Select data to export</p>
          <p className="mt-0.5 text-xs text-slate-500">Choose one or more export types</p>
        </div>

        <div className="space-y-2" role="group" aria-labelledby="export-legend">
          {(Object.entries(EXPORT_OPTIONS) as [ExportType, any][]).map(([type, { label, description, icon }]) => (
            <label
              key={type}
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"
            >
              <input
                type="checkbox"
                checked={selectedTypes.has(type)}
                onChange={() => handleToggleType(type)}
                disabled={exporting}
                aria-label={`${label}: ${description}`}
                className="mt-1 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden="true">{icon}</span>
                  <p className="font-medium text-slate-900">{label}</p>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{description}</p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Export filters">
        <div className="mb-4">
          <p className="text-sm font-semibold text-slate-900">Filter options</p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="export-department" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department</label>
            <select
              id="export-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value as "Physio" | "Dental" | "All")}
              disabled={exporting}
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            >
              {getDepartmentOptions().map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="export-date-range" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date range</label>
            <select
              id="export-date-range"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              disabled={exporting}
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            >
              <option value="all">All time</option>
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="this-year">This year</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          {dateRange === "custom" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="export-start-date" className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</label>
                <input
                  id="export-start-date"
                  type="date"
                  aria-label="Export start date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={exporting}
                  className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="export-end-date" className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</label>
                <input
                  id="export-end-date"
                  type="date"
                  aria-label="Export end date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={exporting}
                  className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <button
        onClick={handleExport}
        disabled={exporting || selectedTypes.size === 0}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {exporting && <Spinner size="xs" className="border-white/30 border-t-white" />}
        {exporting ? "Exporting..." : `Export ${selectedTypes.size} dataset${selectedTypes.size !== 1 ? "s" : ""}`}
      </button>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-semibold mb-1">Export includes:</p>
        <ul className="space-y-0.5 text-slate-500">
          <li>• All relevant columns for each data type</li>
          <li>• Filtered by department and date range</li>
          <li>• Department-scoped data only (per your access)</li>
          <li>• UTF-8 encoding for international characters</li>
        </ul>
      </div>
    </div>
  );
}
