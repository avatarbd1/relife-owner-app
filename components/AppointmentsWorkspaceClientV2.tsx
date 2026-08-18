"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppointmentStatusControl from "@/components/AppointmentStatusControl";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";
type Scope = "combined" | "physio" | "dental";
type Tab = "schedule" | "calendar" | "clinicians";

type AppointmentView = {
  appointmentId: string;
  date: string;
  time: string;
  patientId: string;
  patientName: string;
  department: Department;
  therapist: string;
  status: string;
  remarks: string;
  canUpdate: boolean;
};

type CalendarDay = {
  date: string;
  total: number;
  physio: number;
  dental: number;
};

type Allocation = {
  gender: string;
  room: string;
  bed: string;
  station: string;
};

type Props = {
  appointments: AppointmentView[];
  calendarDays: CalendarDay[];
  selectedDate: string;
  today: string;
  scope: Scope;
  scopeLabel: string;
  initialTab?: Tab;
  focusExceptions?: boolean;
  canCreatePhysio: boolean;
  canCreateDental: boolean;
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

function dateObject(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function shiftDate(value: string, days: number): string {
  const date = dateObject(value);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseTime(value: string): number {
  const text = value.trim().toUpperCase();
  const twelve = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (twelve) {
    let hour = Number(twelve[1]) % 12;
    if (twelve[3] === "PM") hour += 12;
    return hour * 60 + Number(twelve[2]);
  }
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (twentyFour) return Number(twentyFour[1]) * 60 + Number(twentyFour[2]);
  return 24 * 60;
}

function formatClock(minutes: number): string {
  const value = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour24 = Math.floor(value / 60);
  const minute = value % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatRange(item: AppointmentView): string {
  const start = parseTime(item.time);
  if (start >= 24 * 60) return item.time;
  const duration = item.department === "Physio" ? 60 : 30;
  return `${formatClock(start)} – ${formatClock(start + duration)}`;
}

function allocationFromRemarks(remarks: string): Allocation {
  const match = /\[PTFLOW\s+([^\]]+)\]/i.exec(remarks || "");
  const result: Allocation = { gender: "", room: "", bed: "", station: "" };
  if (!match) return result;
  for (const part of match[1].split(";")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    const normalized = key?.trim().toLowerCase();
    if (normalized === "gender") result.gender = value;
    if (normalized === "room") result.room = value;
    if (normalized === "bed") result.bed = value;
    if (normalized === "station") result.station = value;
  }
  return result;
}

function cleanRemarks(remarks: string): string {
  return String(remarks || "").replace(/\s*\[PTFLOW\s+[^\]]+\]/gi, "").trim();
}

function normalizedBed(value: string): "Bed 1" | "Bed 2" | "Bed 3" | "Bed 4" | "" {
  const match = /bed[-\s]*([1-4])/i.exec(value || "");
  return match ? (`Bed ${match[1]}` as "Bed 1" | "Bed 2" | "Bed 3" | "Bed 4") : "";
}

function roomForBed(value: string): "Room 1" | "Room 2" | "" {
  const bed = normalizedBed(value);
  if (bed === "Bed 1" || bed === "Bed 2") return "Room 1";
  if (bed === "Bed 3" || bed === "Bed 4") return "Room 2";
  return "";
}

function isOpen(status: string): boolean {
  return !["completed", "no-show", "cancelled", "canceled"].includes(status.trim().toLowerCase());
}

function statusStyle(status: string): string {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "border-emerald-200 bg-emerald-100 text-emerald-700";
  if (["no-show", "cancelled", "canceled"].includes(value)) return "border-red-200 bg-red-100 text-red-700";
  if (["arrived", "waiting", "in treatment"].includes(value)) return "border-amber-200 bg-amber-100 text-amber-800";
  return "border-blue-200 bg-blue-100 text-blue-800";
}

function roomGenderLabel(items: AppointmentView[], room: "Room 1" | "Room 2"): { label: string; tone: string } {
  const genders = new Set(
    items
      .map((item) => allocationFromRemarks(item.remarks))
      .filter((allocation) => (allocation.room || roomForBed(allocation.bed)) === room)
      .map((allocation) => allocation.gender)
      .filter(Boolean)
  );
  if (genders.size > 1) return { label: "⚠ Mixed", tone: "border-red-200 bg-red-50 text-red-700" };
  if (genders.size === 1) {
    const gender = [...genders][0];
    return { label: gender, tone: gender === "Female" ? "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700" : "border-blue-200 bg-blue-50 text-blue-700" };
  }
  return { label: "Open", tone: "border-slate-200 bg-slate-50 text-slate-500" };
}

function bedOccupant(items: AppointmentView[], bed: "Bed 1" | "Bed 2" | "Bed 3" | "Bed 4"): AppointmentView | undefined {
  return items.find((item) => normalizedBed(allocationFromRemarks(item.remarks).bed) === bed);
}

export default function AppointmentsWorkspaceClientV2({
  appointments,
  calendarDays,
  selectedDate,
  today,
  scope,
  scopeLabel,
  initialTab = "schedule",
  focusExceptions = false,
  canCreatePhysio,
  canCreateDental,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);

  const ordered = useMemo(
    () => [...appointments].sort((a, b) => parseTime(a.time) - parseTime(b.time)),
    [appointments]
  );
  const summary = useMemo(() => {
    const completed = appointments.filter((item) => item.status.trim().toLowerCase() === "completed").length;
    const open = appointments.filter((item) => isOpen(item.status)).length;
    const inClinic = appointments.filter((item) => ["arrived", "waiting", "in treatment"].includes(item.status.trim().toLowerCase())).length;
    return { total: appointments.length, completed, open, inClinic };
  }, [appointments]);
  const clinicianGroups = useMemo(() => {
    const groups = new Map<string, AppointmentView[]>();
    for (const item of ordered) {
      const key = item.therapist || "Unassigned";
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ordered]);
  const physioHourGroups = useMemo(() => {
    const groups = new Map<string, AppointmentView[]>();
    for (const item of ordered.filter((row) => row.department === "Physio" && isOpen(row.status))) {
      groups.set(item.time, [...(groups.get(item.time) || []), item]);
    }
    return [...groups.entries()].sort((a, b) => parseTime(a[0]) - parseTime(b[0]));
  }, [ordered]);

  function navigateDate(next: string) {
    haptic("tap");
    const params = new URLSearchParams({ date: next, scope });
    if (tab !== "schedule") params.set("tab", tab);
    if (focusExceptions) params.set("focus", "exceptions");
    router.push(`/appointments?${params.toString()}`);
  }

  function renderAppointmentCard(item: AppointmentView) {
    const allocation = allocationFromRemarks(item.remarks);
    const remarks = cleanRemarks(item.remarks);
    const room = allocation.room || roomForBed(allocation.bed);
    const bed = normalizedBed(allocation.bed) || allocation.bed;
    const station = allocation.station === "Traction" ? "Traction" : [room, bed].filter(Boolean).join(" · ");
    return (
      <article key={item.appointmentId} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${item.department === "Physio" ? "border-blue-100" : "border-emerald-100"}`}>
        <div className={`border-l-4 p-4 ${item.department === "Physio" ? "border-blue-500" : "border-emerald-500"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500">{formatRange(item)}</p>
              <h3 className="mt-1 truncate text-lg font-bold text-slate-950">{item.patientName}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{item.patientId} · {item.department}{allocation.gender ? ` · ${allocation.gender}` : ""}</p>
            </div>
            <span className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase ${statusStyle(item.status)}`}>{item.status}</span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Therapist</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{item.therapist || "Unassigned"}</p>
            </div>
            {item.department === "Physio" ? (
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Room / station</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{station || "Allocation pending"}</p>
              </div>
            ) : null}
          </div>
          {remarks ? <p className="mt-3 text-xs text-slate-500">{remarks}</p> : null}
          {item.canUpdate ? <AppointmentStatusControl appointmentId={item.appointmentId} department={item.department} currentStatus={item.status} /> : null}
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900 p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Appointments · {scopeLabel}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">Schedule & booking</h1>
              <p className="mt-1 text-xs text-blue-100/80">Hourly Physio capacity · gender-safe room allocation</p>
            </div>
            {(canCreatePhysio || canCreateDental) ? (
              <Link href="/appointments/new" className="shrink-0 rounded-xl bg-white px-3.5 py-2.5 text-xs font-bold text-blue-950 shadow-md">+ Book</Link>
            ) : null}
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {[["Total", summary.total], ["Open", summary.open], ["In clinic", summary.inClinic], ["Done", summary.completed]].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10">
                <p className="text-lg font-bold tabular-nums">{value}</p>
                <p className="text-[10px] text-blue-100/75">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigateDate(shiftDate(selectedDate, -1))} className="min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-700" aria-label="Previous day">‹</button>
            <button type="button" onClick={() => navigateDate(today)} className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700">Today</button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Appointment date</span>
              <input type="date" value={selectedDate} onChange={(event) => navigateDate(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-700" />
            </label>
            <button type="button" onClick={() => navigateDate(shiftDate(selectedDate, 1))} className="min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-700" aria-label="Next day">›</button>
          </div>
          <p className="mt-2 text-center text-xs font-medium text-slate-500">{DAY_FORMAT.format(dateObject(selectedDate))}</p>
        </div>
      </section>

      <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        {(["schedule", "calendar", "clinicians"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => { setTab(item); haptic("tap"); }}
            className={`min-h-10 rounded-lg px-2 py-2 text-xs font-bold capitalize ${tab === item ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "schedule" ? (
        <div className="space-y-4">
          {focusExceptions ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <div>
                <p className="font-bold">No-show / cancelled only</p>
                <p className="mt-0.5 text-xs">Showing appointment exceptions.</p>
              </div>
              <Link href={`/appointments?date=${encodeURIComponent(selectedDate)}&scope=${scope}`} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200">Show all</Link>
            </div>
          ) : null}

          {physioHourGroups.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Physio capacity · gender-wise</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Capacity is calculated per appointment hour, not across the whole day.</p>
              </div>
              <div className="mt-3 space-y-3">
                {physioHourGroups.map(([time, items]) => {
                  const occupiedBeds = new Set(items.map((item) => normalizedBed(allocationFromRemarks(item.remarks).bed)).filter(Boolean));
                  const room1 = roomGenderLabel(items, "Room 1");
                  const room2 = roomGenderLabel(items, "Room 2");
                  const tractionBusy = items.some((item) => allocationFromRemarks(item.remarks).station === "Traction");
                  const waiting = items.filter((item) => {
                    const allocation = allocationFromRemarks(item.remarks);
                    return !normalizedBed(allocation.bed) && allocation.station !== "Traction";
                  }).length;
                  return (
                    <div key={time} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-slate-900">{formatClock(parseTime(time))} – {formatClock(parseTime(time) + 60)}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">{occupiedBeds.size}/4 treatment beds occupied{waiting ? ` · ${waiting} allocation pending` : ""}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tractionBusy ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>Traction {tractionBusy ? "busy" : "free"}</span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[{ room: "Room 1" as const, state: room1, beds: ["Bed 1", "Bed 2"] as const }, { room: "Room 2" as const, state: room2, beds: ["Bed 3", "Bed 4"] as const }].map((room) => (
                          <div key={room.room} className="rounded-xl border border-slate-200 bg-white p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-bold text-slate-800">{room.room}</p>
                              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${room.state.tone}`}>{room.state.label}</span>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {room.beds.map((bed) => {
                                const occupant = bedOccupant(items, bed);
                                return (
                                  <div key={bed} className={`rounded-lg px-2 py-1.5 text-[10px] ${occupant ? "bg-blue-50 text-blue-900" : "bg-slate-50 text-slate-400"}`}>
                                    <span className="font-bold">{bed}</span>{occupant ? ` · ${occupant.patientName}` : " · Free"}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {ordered.length > 0 ? <div className="space-y-3">{ordered.map(renderAppointmentCard)}</div> : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm font-bold text-slate-800">No appointments</p>
              <p className="mt-1 text-xs text-slate-500">No booking found for this date.</p>
            </div>
          )}

          {(canCreatePhysio || canCreateDental) ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Quick booking</h2>
              <p className="mt-1 text-xs text-slate-500">Choose department, patient, hour and gender-safe bed.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {canCreatePhysio ? <Link href="/appointments/new?department=Physio" className="rounded-xl bg-blue-800 px-4 py-3 text-center text-sm font-bold text-white">New Physio</Link> : null}
                {canCreateDental ? <Link href="/appointments/new?department=Dental" className="rounded-xl bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white">New Dental</Link> : null}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "calendar" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">{MONTH_FORMAT.format(dateObject(selectedDate))}</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Tap a date to open its schedule.</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {calendarDays.map((day) => {
              const active = day.date === selectedDate;
              return (
                <button key={day.date} type="button" onClick={() => navigateDate(day.date)} className={`min-h-16 rounded-xl border p-2 text-left ${active ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                  <span className="block text-xs font-bold">{Number(day.date.slice(-2))}</span>
                  <span className={`mt-1 block text-[9px] ${active ? "text-blue-100" : "text-slate-400"}`}>{day.total} total</span>
                  {day.total ? <span className={`block text-[9px] ${active ? "text-blue-100" : "text-slate-400"}`}>P{day.physio} · D{day.dental}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === "clinicians" ? (
        <div className="space-y-3">
          {clinicianGroups.length > 0 ? clinicianGroups.map(([clinician, items]) => (
            <section key={clinician} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">{clinician}</h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">{items.length} appointments</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {items.map((item) => (
                  <div key={item.appointmentId} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900">{item.patientName}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{formatRange(item)} · {item.department}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${statusStyle(item.status)}`}>{item.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )) : <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">No clinician appointments.</div>}
        </div>
      ) : null}
    </div>
  );
}
