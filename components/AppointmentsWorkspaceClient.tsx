"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import AppointmentStatusControl from "@/components/AppointmentStatusControl";
import AppointmentArrivedButton from "@/components/AppointmentArrivedButton";
import AppointmentChamberAllocation from "@/components/AppointmentChamberAllocation";
import { haptic } from "@/lib/interactions";
import {
  allocationFromRemarks,
  allocationToChamber,
  cleanRemarks,
  type AllocationFromRemarks,
} from "@/lib/domain/appointments/allocation";

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

const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateObject(value: string): Date {
  const { year, month, day } = dateParts(value);
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
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (!match) return 24 * 60;
  let hour = Number(match[1]) % 12;
  if (match[3] === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function formatEndTime(value: string, minutes = 30): string {
  const start = parseTime(value);
  if (start >= 24 * 60) return "";
  const end = (start + minutes) % (24 * 60);
  const hour24 = Math.floor(end / 60);
  const minute = end % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function statusStyle(status: string): string {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "border-emerald-200 bg-emerald-100 text-emerald-700";
  if (["no-show", "cancelled", "canceled"].includes(value)) {
    return "border-red-200 bg-red-100 text-red-700";
  }
  if (["arrived", "waiting", "in treatment"].includes(value)) {
    return "border-amber-200 bg-amber-100 text-amber-700";
  }
  return "border-blue-200 bg-blue-100 text-blue-800";
}

function statusDot(status: string): string {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "bg-emerald-500";
  if (["no-show", "cancelled", "canceled"].includes(value)) return "bg-red-500";
  if (["arrived", "waiting", "in treatment"].includes(value)) return "bg-amber-500";
  return "bg-blue-500";
}

function isOpen(status: string): boolean {
  return !["completed", "no-show", "cancelled", "canceled"].includes(status.trim().toLowerCase());
}

export default function AppointmentsWorkspaceClient({
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
    const completed = appointments.filter((item) => item.status.toLowerCase() === "completed").length;
    const missed = appointments.filter((item) => ["no-show", "cancelled", "canceled"].includes(item.status.toLowerCase())).length;
    const open = appointments.filter((item) => isOpen(item.status)).length;
    const inClinic = appointments.filter((item) => ["arrived", "waiting", "in treatment"].includes(item.status.toLowerCase())).length;
    return { total: appointments.length, completed, missed, open, inClinic };
  }, [appointments]);

  const clinicianGroups = useMemo(() => {
    const groups = new Map<string, AppointmentView[]>();
    for (const item of ordered) {
      const key = item.therapist || "Unassigned";
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ordered]);

  const physioOpen = appointments.filter((item) => item.department === "Physio" && isOpen(item.status));
  const assignedTreatmentBeds = new Set(
    physioOpen
      .map((item) => allocationFromRemarks(item.remarks))
      .filter((allocation) => allocation.station === "Treatment" && allocation.bed)
      .map((allocation) => allocation.bed)
  ).size;
  const tractionBusy = physioOpen.some(
    (item) => allocationFromRemarks(item.remarks).station === "Traction"
  );
  const allocationWaitingAppointments = physioOpen.filter((item) => {
    const allocation = allocationFromRemarks(item.remarks);
    return allocation.room === "Waiting" || allocation.station === "Waiting";
  });
  const waitingAllocation = allocationWaitingAppointments.length;
  const firstGenderMissing = allocationWaitingAppointments.find(
    (item) => !allocationFromRemarks(item.remarks).gender
  );

  function navigateDate(next: string) {
    haptic("tap");
    const params = new URLSearchParams({ date: next, scope });
    if (tab !== "schedule") params.set("tab", tab);
    if (focusExceptions) params.set("focus", "exceptions");
    router.push(`/appointments?${params.toString()}`);
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "schedule", label: "Schedule" },
    { id: "calendar", label: "Calendar" },
    { id: "clinicians", label: "Clinicians" },
  ];

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900 p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Appointments · {scopeLabel}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">Schedule & booking</h1>
              <p className="mt-1 text-xs text-blue-100/80">Live appointment flow, clinician and room allocation</p>
            </div>
            {(canCreatePhysio || canCreateDental) && (
              <Link
                href="/appointments/new"
                className="relife-interactive shrink-0 rounded-xl bg-white px-3.5 py-2.5 text-xs font-semibold text-blue-950 shadow-md"
              >
                + Book
              </Link>
            )}
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            {[
              ["Total", summary.total],
              ["Open", summary.open],
              ["In clinic", summary.inClinic],
              ["Done", summary.completed],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10">
                <p className="text-lg font-bold tabular-nums">{value}</p>
                <p className="text-[10px] text-blue-100/75">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigateDate(shiftDate(selectedDate, -1))}
              className="relife-interactive min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-700"
              aria-label="Previous day"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => navigateDate(today)}
              className="relife-interactive min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
            >
              Today
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Appointment date</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => navigateDate(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-700"
              />
            </label>
            <button
              type="button"
              onClick={() => navigateDate(shiftDate(selectedDate, 1))}
              className="relife-interactive min-h-11 min-w-11 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-700"
              aria-label="Next day"
            >
              ›
            </button>
          </div>
          <p className="mt-2 text-center text-xs font-medium text-slate-500">{DAY_FORMAT.format(dateObject(selectedDate))}</p>
        </div>
      </section>

      <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              haptic("tap");
              setTab(item.id);
            }}
            className={`relife-interactive min-h-10 rounded-lg px-2 py-2 text-xs font-semibold ${
              tab === item.id
                ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "schedule" && (
        <div className="space-y-4">
          {focusExceptions && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <div>
                <p className="font-semibold">No-show / cancelled only</p>
                <p className="mt-0.5 text-xs">Showing today&apos;s appointment exceptions.</p>
              </div>
              <Link
                href={`/appointments?date=${encodeURIComponent(selectedDate)}&scope=${scope}`}
                className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200"
              >
                Show all
              </Link>
            </div>
          )}

          {waitingAllocation > 0 && (
            firstGenderMissing ? (
              <Link
                href={`/patients/${encodeURIComponent(firstGenderMissing.patientId)}?edit=1#patient-edit`}
                className="block rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-800 active:bg-amber-200"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Action needed · {waitingAllocation} Physio allocation waiting</p>
                    <p className="mt-0.5 text-xs">Gender is missing. Tap here to fix it now.</p>
                  </div>
                  <span className="shrink-0 text-lg" aria-hidden="true">›</span>
                </div>
              </Link>
            ) : (
              <div className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-800">
                <p className="font-semibold">Action needed · {waitingAllocation} Physio allocation waiting</p>
                <p className="mt-0.5 text-xs">Patient resource assignment is incomplete for this booking.</p>
              </div>
            )
          )}

          {physioOpen.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Physio capacity</h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">Current open bookings on selected date</p>
                </div>
                <span className="text-xs font-semibold text-slate-600">{assignedTreatmentBeds}/4 beds</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full origin-left rounded-full bg-blue-700 transition-transform duration-200 ease-out"
                  style={{ transform: `scaleX(${Math.min(1, assignedTreatmentBeds / 4)})` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                <span>Treatment beds assigned</span>
                <span className={tractionBusy ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
                  Traction: {tractionBusy ? "Busy" : "Available"}
                </span>
              </div>
            </section>
          )}

          <section className="space-y-3">
            {ordered.map((appointment) => {
              const allocation = allocationFromRemarks(appointment.remarks);
              const notes = cleanRemarks(appointment.remarks);
              const allocationWaiting = allocation.room === "Waiting" || allocation.station === "Waiting";
              const genderMissing = appointment.department === "Physio" && allocationWaiting && !allocation.gender;
              const { allocation: chamberAllocation, canReceive } = allocationToChamber(allocation, appointment.status);
              return (
                <article
                  key={`${appointment.department}-${appointment.appointmentId}`}
                  className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                    allocationWaiting ? "border-amber-300" : "border-slate-200"
                  }`}
                >
                  <div className="flex">
                    <div className={`w-1.5 shrink-0 ${statusDot(appointment.status)}`} />
                    <div className="min-w-0 flex-1 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold tabular-nums text-slate-500">
                            {appointment.time} {formatEndTime(appointment.time) ? `– ${formatEndTime(appointment.time)}` : ""}
                          </p>
                          <Link href={`/patients/${encodeURIComponent(appointment.patientId)}`} className="mt-1 block">
                            <h2 className="truncate text-base font-semibold text-slate-950">
                              {appointment.patientName || appointment.patientId}
                            </h2>
                          </Link>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {appointment.patientId} · {appointment.department}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(appointment.status)}`}>
                          {appointment.status}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {appointment.department === "Dental" ? "Dentist" : "Therapist"}
                          </p>
                          <p className="mt-0.5 text-sm font-medium text-slate-800">{appointment.therapist || "Unassigned"}</p>
                        </div>
                        <div className={`rounded-xl px-3 py-2.5 ${allocationWaiting ? "bg-amber-50" : "bg-slate-50"}`}>
                          <p className={`text-[10px] font-semibold uppercase tracking-wide ${allocationWaiting ? "text-amber-600" : "text-slate-400"}`}>
                            Room / station
                          </p>
                          <p className={`mt-0.5 text-sm font-medium ${allocationWaiting ? "text-amber-800" : "text-slate-800"}`}>
                            {appointment.department === "Dental"
                              ? "Dental chair"
                              : [allocation.room, allocation.bed || allocation.station].filter(Boolean).join(" · ") || "Not assigned"}
                          </p>
                        </div>
                      </div>

                      {genderMissing && (
                        <Link
                          href={`/patients/${encodeURIComponent(appointment.patientId)}?edit=1#patient-edit`}
                          className="mt-2 flex min-h-10 items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800"
                        >
                          <span>Fix patient gender</span>
                          <span aria-hidden="true">→</span>
                        </Link>
                      )}

                      {notes && <p className="mt-3 text-xs leading-5 text-slate-500">{notes}</p>}

                      {appointment.department === "Physio" && chamberAllocation && (
                        <div className="mt-3">
                          <AppointmentChamberAllocation allocation={chamberAllocation} />
                        </div>
                      )}

                      {appointment.department === "Physio" && canReceive && (
                        <div className="mt-3">
                          <AppointmentArrivedButton
                            appointmentId={appointment.appointmentId}
                            patientName={appointment.patientName}
                            status={appointment.status}
                            canReceive={canReceive}
                          />
                        </div>
                      )}

                      {appointment.canUpdate && (
                        <div className="mt-3">
                          <AppointmentStatusControl
                            appointmentId={appointment.appointmentId}
                            department={appointment.department}
                            currentStatus={appointment.status}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {ordered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
                <p className="text-sm font-semibold text-slate-700">No appointments booked</p>
                <p className="mt-1 text-xs text-slate-400">This date is currently clear.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "calendar" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{MONTH_FORMAT.format(dateObject(selectedDate))}</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Appointment volume by day</p>
            </div>
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-semibold text-blue-800">
              {calendarDays.reduce((sum, item) => sum + item.total, 0)} month total
            </span>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {Array.from({ length: dateObject(`${selectedDate.slice(0, 7)}-01`).getDay() }).map((_, index) => (
              <span key={`pad-${index}`} aria-hidden="true" />
            ))}
            {calendarDays.map((day) => {
              const active = day.date === selectedDate;
              return (
                <button
                  type="button"
                  key={day.date}
                  onClick={() => navigateDate(day.date)}
                  className={`relife-interactive min-h-[58px] rounded-xl border p-1.5 text-left ${
                    active
                      ? "border-blue-700 bg-blue-700 text-white shadow-md"
                      : day.total > 0
                        ? "border-blue-100 bg-blue-50 text-slate-800"
                        : "border-slate-100 bg-slate-50 text-slate-500"
                  }`}
                >
                  <span className="block text-xs font-semibold">{Number(day.date.slice(-2))}</span>
                  {day.total > 0 && (
                    <span className={`mt-1 block text-[9px] font-semibold ${active ? "text-blue-100" : "text-blue-700"}`}>
                      {day.total} appt
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-800">
              <p className="text-lg font-bold tabular-nums">{calendarDays.reduce((sum, item) => sum + item.physio, 0)}</p>
              <p className="text-[10px] font-semibold uppercase">Physio</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
              <p className="text-lg font-bold tabular-nums">{calendarDays.reduce((sum, item) => sum + item.dental, 0)}</p>
              <p className="text-[10px] font-semibold uppercase">Dental</p>
            </div>
          </div>
        </section>
      )}

      {tab === "clinicians" && (
        <section className="space-y-3">
          {clinicianGroups.map(([clinician, items]) => (
            <div key={clinician} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{clinician}</h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">{items[0]?.department || ""}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{items.length} booked</span>
              </div>
              <div className="mt-3 space-y-2">
                {items.map((item) => (
                  <Link
                    href={`/patients/${encodeURIComponent(item.patientId)}`}
                    key={item.appointmentId}
                    className="relife-interactive flex min-h-12 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{item.time} · {item.patientName || item.patientId}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{item.department}</p>
                    </div>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(item.status)}`} aria-label={item.status} />
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {clinicianGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400">
              No clinician schedule for this date.
            </div>
          )}
        </section>
      )}

      {(canCreatePhysio || canCreateDental) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Quick booking</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Start with the department, then choose the patient.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {canCreatePhysio && (
              <Link href="/appointments/new?department=Physio" className="relife-interactive flex min-h-11 items-center justify-center rounded-xl bg-blue-800 px-3 text-xs font-semibold text-white shadow-sm">
                New Physio
              </Link>
            )}
            {canCreateDental && (
              <Link href="/appointments/new?department=Dental" className="relife-interactive flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-3 text-xs font-semibold text-white shadow-sm">
                New Dental
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
