"use client";

import { useMemo, useState } from "react";
import { InlineNotice, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Category = "Login" | "Patient" | "Finance" | "Access" | "System";
type Severity = "success" | "info" | "warning" | "critical";
type EventItem = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  patientId: string;
  beforeValue: string;
  afterValue: string;
  reason: string;
  department: "Physio" | "Dental";
  sourceSystem: string;
  category: Category;
  severity: Severity;
};

const FILTERS: Array<"All" | Category> = ["All", "Login", "Patient", "Finance", "Access", "System"];

function toneFor(severity: Severity): "success" | "info" | "warning" | "error" {
  return severity === "critical" ? "error" : severity;
}

function dotClass(severity: Severity): string {
  if (severity === "success") return "bg-emerald-500";
  if (severity === "warning") return "bg-amber-500";
  if (severity === "critical") return "bg-red-600";
  return "bg-blue-500";
}

function csvCell(value: string): string {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

export default function AuditLogClient({
  events,
  critical,
}: {
  events: EventItem[];
  critical: EventItem[];
}) {
  const [filter, setFilter] = useState<"All" | Category>("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(
    () => (filter === "All" ? events : events.filter((event) => event.category === filter)),
    [events, filter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const event of filtered) {
      const date = event.timestamp.slice(0, 10) || "Unknown date";
      const rows = map.get(date) || [];
      rows.push(event);
      map.set(date, rows);
    }
    return [...map.entries()];
  }, [filtered]);

  function exportCsv() {
    const headers = [
      "Timestamp",
      "Department",
      "Actor",
      "Category",
      "Action",
      "Entity Type",
      "Entity ID",
      "Patient ID",
      "Before",
      "After",
      "Reason",
      "Source",
    ];
    const rows = filtered.map((event) => [
      event.timestamp,
      event.department,
      event.actor,
      event.category,
      event.action,
      event.entityType,
      event.entityId,
      event.patientId,
      event.beforeValue,
      event.afterValue,
      event.reason,
      event.sourceSystem,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relife-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    haptic("success");
  }

  return (
    <div className="space-y-4">
      {critical.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-red-900">Security / integrity alerts</h2>
              <p className="mt-0.5 text-xs text-red-700">Derived only from actual critical audit actions.</p>
            </div>
            <StatusBadge tone="error">{critical.length} critical</StatusBadge>
          </div>
          <div className="mt-3 space-y-2">
            {critical.slice(0, 3).map((event) => (
              <div key={event.id} className="rounded-lg bg-white/70 p-3 ring-1 ring-red-100">
                <p className="text-xs font-semibold text-red-900">{event.action}</p>
                <p className="mt-0.5 text-[11px] text-red-700">{event.timestamp} · {event.actor} · {event.department}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Audit filters</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{filtered.length} of {events.length} loaded events</p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="min-h-10 shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100"
          >
            Export CSV
          </button>
        </div>
        <div className="mt-3 overflow-x-auto" data-horizontal-scroll>
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Audit event filters">
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setFilter(item);
                  haptic("tap");
                }}
                className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${filter === item ? "bg-blue-800 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      {grouped.length === 0 && <InlineNotice tone="neutral">এই filter-এ কোনো audit event পাওয়া যায়নি।</InlineNotice>}

      <div className="space-y-5">
        {grouped.map(([date, rows]) => (
          <section key={date}>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-md bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-700">{date}</span>
              <span className="text-[11px] text-slate-400">{rows.length} events</span>
            </div>
            <div className="relative ml-2 border-l border-slate-200 pl-5">
              {rows.map((event) => {
                const open = expanded === event.id;
                return (
                  <article key={event.id} className="relative mb-3 last:mb-0">
                    <span className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-slate-50 ${dotClass(event.severity)}`} aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(open ? null : event.id);
                        haptic("tap");
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:bg-slate-50"
                      aria-expanded={open}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{event.action}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{event.timestamp} · {event.actor}</p>
                        </div>
                        <StatusBadge tone={toneFor(event.severity)}>{event.category}</StatusBadge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{event.department}</span>
                        <span>·</span>
                        <span>{event.entityType}{event.entityId ? ` #${event.entityId}` : ""}</span>
                        {event.patientId && <><span>·</span><span>Patient {event.patientId}</span></>}
                      </div>
                      {open && (
                        <div className="relife-fade-in mt-3 space-y-2 border-t border-slate-100 pt-3">
                          {event.reason && <p className="text-xs leading-5 text-slate-600"><strong>Reason:</strong> {event.reason}</p>}
                          {event.beforeValue && <div className="rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-600"><strong>Before:</strong> {event.beforeValue}</div>}
                          {event.afterValue && <div className="rounded-lg bg-blue-50 p-2 text-[11px] leading-5 text-blue-800"><strong>After:</strong> {event.afterValue}</div>}
                          {event.sourceSystem && <p className="text-[10px] text-slate-400">Source: {event.sourceSystem} · Audit ID: {event.id}</p>}
                        </div>
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
