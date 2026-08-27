"use client";

import { useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import { ProgressBar, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { formatBDT } from "@/lib/format";
import { fetchRangeReportsData } from "./rangeReportsActions";
import type { Scope } from "@/lib/types";

type RangeData = Awaited<ReturnType<typeof fetchRangeReportsData>>;

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default function RangeReports({ scope }: { scope: Scope }) {
  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [rangeData, setRangeData] = useState<RangeData | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDateRangeChange(startDate: string, endDate: string) {
    setDateRange({ startDate, endDate });
    setIsPending(true);
    setError(null);
    try {
      const data = await fetchRangeReportsData(startDate, endDate, scope);
      setRangeData(data);
    } catch (err) {
      setRangeData(null);
      const message = err instanceof Error ? err.message : "RANGE_REPORT_FAILED";
      setError(
        message === "INVALID_DATE_RANGE"
          ? "তারিখের range সঠিক নয়।"
          : message === "ACCESS_DENIED"
            ? "এই financial report দেখার অনুমতি নেই।"
            : "Range report load করা যায়নি।"
      );
    } finally {
      setIsPending(false);
    }
  }

  const businessPos = rangeData?.businessPos;
  const collection = rangeData?.collection;
  const recovery =
    businessPos && businessPos.totalBusinessLiability > 0
      ? Math.max(0, (businessPos.monthCollection / businessPos.totalBusinessLiability) * 100)
      : 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Date range reports</h2>
          <p className="mt-0.5 text-xs text-slate-500">Today, yesterday, 7 days, this month, or a custom period.</p>
        </div>
        <StatusBadge tone="info">{SCOPE_LABEL[scope]}</StatusBadge>
      </div>

      <div className="mt-4">
        <DateRangePicker onRangeChange={handleDateRangeChange} defaultRange="month" />
      </div>

      {dateRange && (
        <p className="mt-3 text-[11px] font-medium text-slate-500">
          Selected: {dateRange.startDate} → {dateRange.endDate}
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
          {error}
        </div>
      )}

      {isPending && (
        <div className="mt-4 flex min-h-20 items-center justify-center rounded-lg bg-slate-50">
          <Spinner label="Loading range report" />
        </div>
      )}

      {!isPending && !rangeData && !error && (
        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
          উপরের কোনো period নির্বাচন করলে report দেখাবে।
        </div>
      )}

      {!isPending && rangeData && businessPos && collection && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-[10px] text-blue-700">Range collection</p>
              <p className="mt-1 text-base font-bold tabular-nums text-blue-950">{formatBDT(businessPos.monthCollection)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-[10px] text-amber-700">Variable expense</p>
              <p className="mt-1 text-base font-bold tabular-nums text-amber-950">{formatBDT(businessPos.variableClinicExpense)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] text-slate-500">Fixed overhead accrual</p>
              <p className="mt-1 text-base font-bold tabular-nums text-slate-950">{formatBDT(businessPos.fixedOverhead)}</p>
            </div>
            <div className="rounded-lg bg-violet-50 p-3">
              <p className="text-[10px] text-violet-700">Salary accrual</p>
              <p className="mt-1 text-base font-bold tabular-nums text-violet-950">{formatBDT(businessPos.fixedSalaryCommitment)}</p>
            </div>
          </div>

          {rangeData.scope === "combined" && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2">
                <p className="text-[10px] text-blue-700">Physio collection</p>
                <p className="mt-0.5 text-xs font-bold tabular-nums text-blue-950">{formatBDT(collection.physio)}</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2">
                <p className="text-[10px] text-emerald-700">Dental collection</p>
                <p className="mt-0.5 text-xs font-bold tabular-nums text-emerald-950">{formatBDT(collection.dental)}</p>
              </div>
            </div>
          )}

          <ProgressBar value={recovery} label="Cost recovery" className="mt-4" />

          <div
            className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 ${
              businessPos.surplusOrUncovered >= 0 ? "bg-emerald-50" : "bg-red-50"
            }`}
          >
            <span className={`text-xs ${businessPos.surplusOrUncovered >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {businessPos.surplusOrUncovered >= 0 ? "Surplus" : "Uncovered"}
            </span>
            <strong className={`text-sm tabular-nums ${businessPos.surplusOrUncovered >= 0 ? "text-emerald-900" : "text-red-900"}`}>
              {formatBDT(Math.abs(businessPos.surplusOrUncovered))}
            </strong>
          </div>

          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            Fixed overhead and current salary commitment are accrued by calendar-day share for the selected range. Internal cash transfers remain excluded from business expense.
          </p>
        </>
      )}
    </section>
  );
}
