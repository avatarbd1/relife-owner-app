"use client";

import { useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import { ProgressBar } from "@/components/FeedbackUI";
import { formatBDT } from "@/lib/format";
import { fetchRangeReportsData } from "./rangeReportsActions";
import type { Scope } from "@/lib/types";

export default function RangeReports({ scope }: { scope: Scope }) {
  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [rangeData, setRangeData] = useState<any>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDateRangeChange(startDate: string, endDate: string) {
    setIsPending(true);
    setError(null);
    try {
      const data = await fetchRangeReportsData(startDate, endDate, scope);
      setDateRange({ startDate, endDate });
      setRangeData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load range data");
    } finally {
      setIsPending(false);
    }
  }

  if (!dateRange || !rangeData) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Custom range reports</h2>
          <p className="mt-0.5 text-xs text-slate-500">Select a date range to view collection and business metrics</p>
        </div>
        <div className="mt-4">
          <DateRangePicker onRangeChange={handleDateRangeChange} defaultRange="month" />
        </div>
      </section>
    );
  }

  const { collection, businessPos } = rangeData;
  const recovery =
    businessPos.totalBusinessLiability > 0
      ? Math.max(0, (collection.combined / businessPos.totalBusinessLiability) * 100)
      : 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Custom range reports</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {dateRange.startDate} to {dateRange.endDate}
          </p>
        </div>
        <button
          onClick={() => setDateRange(null)}
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          Change
        </button>
      </div>

      <div className="mt-4">
        <DateRangePicker onRangeChange={handleDateRangeChange} defaultRange="month" />
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {isPending ? (
        <div className="mt-4 text-center text-xs text-slate-500">Loading...</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-[10px] text-blue-700">Range collection</p>
              <p className="mt-1 text-base font-bold tabular-nums text-blue-950">{formatBDT(collection.combined)}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-[10px] text-blue-700">Physio</p>
              <p className="mt-1 text-base font-bold tabular-nums text-blue-950">{formatBDT(collection.physio)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-[10px] text-amber-700">Variable expense</p>
              <p className="mt-1 text-base font-bold tabular-nums text-amber-950">
                {formatBDT(businessPos.variableClinicExpense)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] text-slate-500">Fixed overhead</p>
              <p className="mt-1 text-base font-bold tabular-nums text-slate-950">{formatBDT(businessPos.fixedOverhead)}</p>
            </div>
          </div>

          <ProgressBar value={recovery} label="Cost recovery" className="mt-4" />

          <div
            className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 ${
              businessPos.surplusOrUncovered >= 0 ? "bg-emerald-50" : "bg-red-50"
            }`}
          >
            <span
              className={`text-xs ${businessPos.surplusOrUncovered >= 0 ? "text-emerald-700" : "text-red-700"}`}
            >
              {businessPos.surplusOrUncovered >= 0 ? "Surplus" : "Uncovered"}
            </span>
            <strong
              className={`text-sm tabular-nums ${
                businessPos.surplusOrUncovered >= 0 ? "text-emerald-900" : "text-red-900"
              }`}
            >
              {formatBDT(Math.abs(businessPos.surplusOrUncovered))}
            </strong>
          </div>

          <p className="mt-2 text-xs text-slate-600">
            Salary commitment: <strong>{formatBDT(businessPos.fixedSalaryCommitment)}</strong>
          </p>
        </>
      )}
    </section>
  );
}
