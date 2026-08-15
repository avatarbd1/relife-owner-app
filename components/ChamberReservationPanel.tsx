"use client";

import { useEffect, useMemo, useState } from "react";
import { InlineNotice, ProgressBar, StatusBadge } from "@/components/FeedbackUI";
import type { ChamberBookingPlanSummary, MachineReservationSummary } from "@/lib/webos/appointmentScheduling";

type Props = {
  plans: ChamberBookingPlanSummary[];
  reservations: MachineReservationSummary[];
};

function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value || "").trim());
  if (!match) return -1;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function dhakaMinuteNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour || 0) * 60 + Number(values.minute || 0);
}

function bedLabel(value: string): string {
  if (value === "TRACTION-BED") return "Traction Bed";
  const match = /^BED-([1-4])$/.exec(value);
  return match ? `Bed ${match[1]}` : value || "Bed pending";
}

export default function ChamberReservationPanel({ plans, reservations }: Props) {
  const [nowMinute, setNowMinute] = useState(dhakaMinuteNow);
  const [tab, setTab] = useState<"timeline" | "machines">("timeline");

  useEffect(() => {
    const timer = window.setInterval(() => setNowMinute(dhakaMinuteNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const machineGroups = useMemo(() => {
    const map = new Map<string, MachineReservationSummary[]>();
    for (const item of reservations) {
      const key = item.resourceId || item.resourceName;
      map.set(key, [...(map.get(key) || []), item]);
    }
    return [...map.entries()]
      .map(([resourceId, rows]) => ({
        resourceId,
        resourceName: rows[0]?.resourceName || resourceId,
        rows: [...rows].sort((a, b) => a.startMinute - b.startMinute),
      }))
      .sort((a, b) => a.resourceName.localeCompare(b.resourceName));
  }, [reservations]);

  const upcomingReservations = reservations.filter((item) => item.endMinute > nowMinute).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700">Booking reservations</p>
          <h2 className="mt-1 text-base font-semibold text-slate-950">Planned treatment & machine locks</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">Appointment-time reservations. Live Chamber runtime locks remain authoritative when treatment actually starts.</p>
        </div>
        <StatusBadge tone={upcomingReservations > 0 ? "info" : "success"}>{upcomingReservations} machine slots</StatusBadge>
      </div>

      <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        <button type="button" onClick={() => setTab("timeline")} className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${tab === "timeline" ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"}`}>Patient timelines · {plans.length}</button>
        <button type="button" onClick={() => setTab("machines")} className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${tab === "machines" ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"}`}>Machine tracker · {machineGroups.length}</button>
      </div>

      {tab === "timeline" && (
        <div className="mt-4 space-y-3 relife-fade-in">
          {plans.map((plan) => {
            const start = parseTime(plan.startTime);
            const elapsed = start >= 0 ? Math.max(0, Math.min(plan.expectedDurationMin, nowMinute - start)) : 0;
            const progress = plan.expectedDurationMin > 0 ? (elapsed / plan.expectedDurationMin) * 100 : 0;
            return (
              <article key={plan.appointmentId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{plan.patientName || plan.patientId}</p><p className="mt-0.5 text-[11px] text-slate-500">{plan.startTime} · {bedLabel(plan.assignedBedId)} · {plan.expectedDurationMin} min</p></div>
                  <StatusBadge tone={start >= 0 && nowMinute >= start && nowMinute < start + plan.expectedDurationMin ? "warning" : nowMinute >= start + plan.expectedDurationMin && start >= 0 ? "success" : "info"}>{start >= 0 && nowMinute >= start && nowMinute < start + plan.expectedDurationMin ? "Scheduled now" : nowMinute >= start + plan.expectedDurationMin && start >= 0 ? "Window passed" : "Upcoming"}</StatusBadge>
                </div>
                {start >= 0 && nowMinute >= start && nowMinute < start + plan.expectedDurationMin && <ProgressBar value={progress} label="Scheduled window" className="mt-3" />}
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1" data-horizontal-scroll>
                  {plan.steps.map((step) => {
                    const active = nowMinute >= step.startMinute && nowMinute < step.endMinute;
                    const past = nowMinute >= step.endMinute;
                    return (
                      <div key={`${plan.appointmentId}-${step.sequence}`} className={`min-w-[140px] rounded-lg border p-2.5 ${active ? "border-amber-300 bg-amber-50" : past ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-400">{step.sequence}</span>{step.resourceId && <span className={`h-2 w-2 rounded-full ${active ? "bg-amber-500" : past ? "bg-emerald-500" : "bg-blue-500"}`} />}</div>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-900">{step.name}</p>
                        <p className="mt-1 text-[10px] tabular-nums text-slate-500">{step.startTime}–{step.endTime}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{step.durationMin} min{step.resourceName ? ` · ${step.resourceName}` : ""}</p>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
          {plans.length === 0 && <InlineNotice tone="neutral">আজকের জন্য reservation-enabled treatment timeline নেই। Legacy appointment Live Chamber-এ আগের flow-তেই চলবে।</InlineNotice>}
        </div>
      )}

      {tab === "machines" && (
        <div className="mt-4 space-y-3 relife-fade-in">
          {machineGroups.map((group) => {
            const active = group.rows.find((row) => nowMinute >= row.startMinute && nowMinute < row.endMinute);
            const next = group.rows.find((row) => row.startMinute > nowMinute);
            const relevant = group.rows.filter((row) => row.endMinute > nowMinute).slice(0, 5);
            return (
              <article key={group.resourceId} className={`rounded-xl border p-3 ${active ? "border-amber-300 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-sm font-semibold text-slate-950">{group.resourceName}</p><p className="mt-0.5 text-[11px] text-slate-500">{active ? `${active.patientName || active.patientId} · ${bedLabel(active.assignedBedId)}` : next ? `Next ${next.startTime} · ${next.patientName || next.patientId}` : "No future reservation"}</p></div>
                  <StatusBadge tone={active ? "warning" : "success"}>{active ? `Reserved until ${active.endTime}` : "Free now"}</StatusBadge>
                </div>
                {relevant.length > 0 && <div className="mt-3 space-y-1.5">{relevant.map((row) => <div key={row.reservationId} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 px-2.5 py-2 text-[11px]"><span className="min-w-0 truncate font-medium text-slate-700">{row.patientName || row.patientId} · {bedLabel(row.assignedBedId)}</span><span className="shrink-0 tabular-nums text-slate-500">{row.startTime}–{row.endTime}</span></div>)}</div>}
              </article>
            );
          })}
          {machineGroups.length === 0 && <InlineNotice tone="success">আজ future machine reservation নেই। Runtime machine availability normalভাবে চলবে।</InlineNotice>}
        </div>
      )}
    </section>
  );
}
