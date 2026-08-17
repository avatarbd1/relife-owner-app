"use client";

import { useState } from "react";
import { haptic } from "@/lib/interactions";

type DateRange = {
  startDate: string;
  endDate: string;
  label: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dhakaDateKey(ref: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatDateBD(dateStr: string): string {
  if (!ISO_DATE.test(dateStr)) return dateStr;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function getDateRanges(now: Date): Record<string, DateRange> {
  const todayDate = dhakaDateKey(now);
  const monthStart = `${todayDate.slice(0, 7)}-01`;
  return {
    today: { startDate: todayDate, endDate: todayDate, label: "Today" },
    yesterday: {
      startDate: shiftIsoDate(todayDate, -1),
      endDate: shiftIsoDate(todayDate, -1),
      label: "Yesterday",
    },
    sevenDays: {
      startDate: shiftIsoDate(todayDate, -6),
      endDate: todayDate,
      label: "7 Days",
    },
    month: { startDate: monthStart, endDate: todayDate, label: "This Month" },
  };
}

export default function DateRangePicker({
  onRangeChange,
  defaultRange = "month",
}: {
  onRangeChange: (startDate: string, endDate: string) => void;
  defaultRange?: string;
}) {
  const ranges = getDateRanges(new Date());
  const [selectedRange, setSelectedRange] = useState(defaultRange);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [appliedCustom, setAppliedCustom] = useState<DateRange | null>(null);

  const currentRange =
    selectedRange === "custom" && appliedCustom
      ? appliedCustom
      : ranges[selectedRange] || ranges.month;

  function handleRangeSelect(key: string) {
    const range = ranges[key];
    if (!range) return;
    haptic("tap");
    setSelectedRange(key);
    setCustomMode(false);
    onRangeChange(range.startDate, range.endDate);
  }

  function handleCustomApply() {
    if (!customStart || !customEnd || customStart > customEnd) {
      haptic("error");
      return;
    }
    const range = { startDate: customStart, endDate: customEnd, label: "Custom" };
    haptic("success");
    setAppliedCustom(range);
    setSelectedRange("custom");
    setCustomMode(false);
    onRangeChange(customStart, customEnd);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.entries(ranges).map(([key, range]) => (
          <button
            type="button"
            key={key}
            onClick={() => handleRangeSelect(key)}
            className={`relife-interactive rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              selectedRange === key
                ? "bg-blue-600 text-white"
                : "border border-slate-300 bg-white text-slate-600"
            }`}
          >
            {range.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustomMode((current) => !current);
            haptic("tap");
          }}
          className={`relife-interactive rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
            selectedRange === "custom" || customMode
              ? "bg-blue-600 text-white"
              : "border border-slate-300 bg-white text-slate-600"
          }`}
        >
          Custom
        </button>
      </div>

      {customMode && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">From</label>
              <input
                type="date"
                value={customStart}
                max={ranges.today.endDate}
                onChange={(event) => setCustomStart(event.currentTarget.value)}
                className="relife-input mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">To</label>
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                max={ranges.today.endDate}
                onChange={(event) => setCustomEnd(event.currentTarget.value)}
                className="relife-input mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={!customStart || !customEnd || customStart > customEnd}
            onClick={handleCustomApply}
            className="relife-interactive w-full rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}

      <div className="text-[11px] text-slate-500">
        {currentRange.label}: {formatDateBD(currentRange.startDate)} — {formatDateBD(currentRange.endDate)}
      </div>
    </div>
  );
}
