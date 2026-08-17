"use client";

import { useState } from "react";
import { haptic } from "@/lib/interactions";

type DateRange = {
  startDate: string;
  endDate: string;
  label: string;
};

function formatDateBD(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getDateRanges(today: Date): Record<string, DateRange> {
  const todayStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(today)
    .reduce((acc, part) => {
      if (part.type === "year") acc.year = part.value;
      if (part.type === "month") acc.month = part.value;
      if (part.type === "day") acc.day = part.value;
      return acc;
    }, {} as Record<string, string>);

  const todayDate = `${todayStr.year}-${todayStr.month}-${todayStr.day}`;

  // Yesterday
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(yesterday)
    .reduce((acc, part) => {
      if (part.type === "year") acc.year = part.value;
      if (part.type === "month") acc.month = part.value;
      if (part.type === "day") acc.day = part.value;
      return acc;
    }, {} as Record<string, string>);
  const yesterdayDate = `${yesterdayStr.year}-${yesterdayStr.month}-${yesterdayStr.day}`;

  // Last 7 days
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(sevenDaysAgo)
    .reduce((acc, part) => {
      if (part.type === "year") acc.year = part.value;
      if (part.type === "month") acc.month = part.value;
      if (part.type === "day") acc.day = part.value;
      return acc;
    }, {} as Record<string, string>);
  const sevenDaysAgoDate = `${sevenDaysAgoStr.year}-${sevenDaysAgoStr.month}-${sevenDaysAgoStr.day}`;

  // This month
  const monthStart = `${todayStr.year}-${todayStr.month}-01`;

  return {
    today: { startDate: todayDate, endDate: todayDate, label: "Today" },
    yesterday: { startDate: yesterdayDate, endDate: yesterdayDate, label: "Yesterday" },
    sevenDays: { startDate: sevenDaysAgoDate, endDate: todayDate, label: "7 Days" },
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
  const now = new Date();
  const ranges = getDateRanges(now);
  const [selectedRange, setSelectedRange] = useState(defaultRange);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const currentRange = ranges[selectedRange] || ranges.month;

  function handleRangeSelect(key: string) {
    haptic("tap");
    const range = ranges[key];
    if (range) {
      setSelectedRange(key);
      setCustomMode(false);
      onRangeChange(range.startDate, range.endDate);
    }
  }

  function handleCustomApply() {
    if (!customStart || !customEnd) {
      haptic("error");
      return;
    }
    if (customStart > customEnd) {
      haptic("error");
      return;
    }
    haptic("success");
    setSelectedRange("custom");
    onRangeChange(customStart, customEnd);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.entries(ranges).map(([key, range]) => (
          <button
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
          onClick={() => setCustomMode(!customMode)}
          className={`relife-interactive rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
            customMode
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
                onChange={(e) => setCustomStart(e.currentTarget.value)}
                className="relife-input mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.currentTarget.value)}
                className="relife-input mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
          </div>
          <button
            onClick={handleCustomApply}
            className="relife-interactive w-full rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Apply
          </button>
        </div>
      )}

      <div className="text-[11px] text-slate-500">
        {formatDateBD(currentRange.startDate)} — {formatDateBD(currentRange.endDate)}
      </div>
    </div>
  );
}
