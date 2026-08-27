"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type AttendanceRecord = {
  checkIn: string;
  breakOut: string;
  breakIn: string;
  checkOut: string;
  workingHours: number | null;
  status: string;
};

type TeamState = "not_in" | "working" | "break" | "checked_out";

type Snapshot = {
  date: string;
  attendance: {
    self: AttendanceRecord | null;
    team: Array<{
      staffId: string;
      fullName: string;
      role: string;
      department: string;
      state: TeamState;
      checkIn: string;
      checkOut: string;
    }>;
    location: {
      configured: boolean;
      radiusMeters: number;
      maxAccuracyMeters: number;
    };
    canAct: boolean;
    canReadTeam: boolean;
  };
  appointments: Array<{
    appointmentId: string;
    time: string;
    patientId: string;
    patientName: string;
    department: "Physio" | "Dental";
    therapist: string;
    status: string;
  }>;
  appointmentCounts: {
    total: number;
    completed: number;
    open: number;
    missed: number;
  };
};

type ActivityCounts = {
  patients: number;
  sessions: number;
  appointments: number;
};

type Action = "check_in" | "break_out" | "break_in" | "check_out";
type Tab = "attendance" | "sessions" | "summary";

const actionLabel: Record<Action, string> = {
  check_in: "Check In",
  break_out: "Break Out",
  break_in: "Break In",
  check_out: "Check Out",
};

const errorText: Record<string, string> = {
  ATTENDANCE_ALREADY_CHECKED_IN: "আজ ইতিমধ্যে Check In করা হয়েছে।",
  ATTENDANCE_ALREADY_ON_BREAK: "Break ইতিমধ্যে শুরু হয়েছে।",
  ATTENDANCE_BREAK_ALREADY_USED: "আজকের break cycle শেষ হয়েছে।",
  ATTENDANCE_BREAK_NOT_STARTED: "আগে Break Out করুন।",
  ATTENDANCE_BREAK_ALREADY_ENDED: "Break ইতিমধ্যে শেষ হয়েছে।",
  ATTENDANCE_BREAK_STILL_OPEN: "Check Out-এর আগে Break In করুন।",
  ATTENDANCE_ALREADY_CHECKED_OUT: "আজ ইতিমধ্যে Check Out করা হয়েছে।",
  ATTENDANCE_NOT_CHECKED_IN: "আগে Check In করুন।",
};

function nextActions(self: AttendanceRecord | null): Action[] {
  if (!self?.checkIn) return ["check_in"];
  if (self.checkOut) return [];
  if (self.breakOut && !self.breakIn) return ["break_in"];
  if (!self.breakOut) return ["break_out", "check_out"];
  return ["check_out"];
}

function stateLabel(state: TeamState) {
  if (state === "working") return "Working";
  if (state === "break") return "On break";
  if (state === "checked_out") return "Checked out";
  return "Not checked in";
}

function stateClass(state: TeamState) {
  if (state === "working") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (state === "break") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (state === "checked_out") return "bg-slate-100 text-slate-600 ring-slate-200";
  return "bg-slate-50 text-slate-500 ring-slate-200";
}

function stateDotClass(state: TeamState) {
  if (state === "working") return "bg-emerald-500";
  if (state === "break") return "bg-amber-500";
  if (state === "checked_out") return "bg-slate-400";
  return "bg-slate-300";
}

function appointmentClass(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "completed") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (["no-show", "cancelled", "canceled"].includes(normalized)) {
    return "bg-red-50 text-red-700 ring-red-200";
  }
  if (["arrived", "in progress", "in-progress"].includes(normalized)) {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }
  return "bg-blue-50 text-blue-700 ring-blue-200";
}

function toMinutes(value: string): number | null {
  const text = value.trim().toUpperCase();
  if (!text) return null;
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(text);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3] === "PM") hour += 12;
    return hour * 60 + Number(twelveHour[2]);
  }
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!twentyFour) return null;
  return Number(twentyFour[1]) * 60 + Number(twentyFour[2]);
}

function timeExtrema(values: string[], mode: "min" | "max") {
  const candidates = values
    .map((value) => ({ value, minutes: toMinutes(value) }))
    .filter((item): item is { value: string; minutes: number } => item.minutes !== null);
  if (candidates.length === 0) return "—";
  return candidates.reduce((best, item) =>
    mode === "min"
      ? item.minutes < best.minutes ? item : best
      : item.minutes > best.minutes ? item : best
  ).value;
}

export default function DailyOperationsClient({
  snapshot,
  activityCounts,
}: {
  snapshot: Snapshot;
  activityCounts: ActivityCounts;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("attendance");

  async function act(action: Action) {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/attendance/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "ATTENDANCE_ACTION_FAILED");
      }
      if (navigator.vibrate) navigator.vibrate(18);
      setMessage(`✓ ${actionLabel[action]} saved`);
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "ATTENDANCE_ACTION_FAILED";
      setMessage(errorText[code] || code);
    } finally {
      setBusy(null);
    }
  }

  const self = snapshot.attendance.self;
  const actions = snapshot.attendance.canAct ? nextActions(self) : [];
  const team = snapshot.attendance.team;

  const summary = useMemo(() => {
    const expected = team.length;
    const notIn = team.filter((staff) => staff.state === "not_in").length;
    const working = team.filter((staff) => staff.state === "working").length;
    const onBreak = team.filter((staff) => staff.state === "break").length;
    const checkedOut = team.filter((staff) => staff.state === "checked_out").length;
    const present = expected - notIn;
    return {
      expected,
      present,
      notIn,
      working,
      onBreak,
      checkedOut,
      absenceRate: expected > 0 ? Math.round((notIn / expected) * 100) : 0,
      earliestStart: timeExtrema(team.map((staff) => staff.checkIn), "min"),
      latestEnd: timeExtrema(team.map((staff) => staff.checkOut), "max"),
    };
  }, [team]);

  const orderedTeam = useMemo(
    () => [...team].sort((a, b) => {
      const rank: Record<TeamState, number> = { working: 0, break: 1, checked_out: 2, not_in: 3 };
      return rank[a.state] - rank[b.state] || a.fullName.localeCompare(b.fullName);
    }),
    [team]
  );

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "attendance", label: "Check-In" },
    { id: "sessions", label: "Sessions" },
    { id: "summary", label: "Summary" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-10 rounded-lg px-2 py-2 text-xs font-semibold transition ${
              tab === item.id
                ? "bg-white text-blue-800 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 active:bg-white/70"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "attendance" && (
        <>
          <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 to-slate-800 p-5 text-white shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-400">
                  My attendance
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  {self?.status || "Not checked in"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  {self?.checkIn ? `Check-in ${self.checkIn}` : "আজকের attendance শুরু হয়নি"}
                  {self?.breakOut && !self.breakIn ? ` · Break since ${self.breakOut}` : ""}
                  {self?.checkOut ? ` · Check-out ${self.checkOut}` : ""}
                </p>
              </div>
              {self?.workingHours !== null && self?.workingHours !== undefined && (
                <span className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold tabular-nums ring-1 ring-white/10">
                  {self.workingHours}h
                </span>
              )}
            </div>

            {actions.length > 0 && (
              <div className={`mt-5 grid gap-2 ${actions.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act(action)}
                    className={`min-h-12 select-none rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
                      action === "check_out"
                        ? "bg-white/10 text-white ring-1 ring-white/15"
                        : "bg-white text-slate-950"
                    }`}
                  >
                    {busy === action ? "Saving…" : actionLabel[action]}
                  </button>
                ))}
              </div>
            )}

            {!self?.checkIn && (
              <p className="mt-3 text-[11px] text-slate-400">Normal clinic attendance · no GPS prompt</p>
            )}

            {message && (
              <p
                className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  message.startsWith("✓")
                    ? "bg-emerald-400/10 text-emerald-200"
                    : "bg-red-400/10 text-red-200"
                }`}
                role="status"
              >
                {message}
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Live staff status</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Role and department scoped</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {summary.present}/{summary.expected} present
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {orderedTeam.map((staff) => (
                <div key={staff.staffId} className="flex min-h-[72px] items-center gap-3 px-4 py-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDotClass(staff.state)}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{staff.fullName}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {staff.role} · {staff.department}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {staff.checkIn ? `In ${staff.checkIn}` : "No check-in"}
                      {staff.checkOut ? ` · Out ${staff.checkOut}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${stateClass(staff.state)}`}>
                    {stateLabel(staff.state)}
                  </span>
                </div>
              ))}
              {team.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">Staff status দেখার permission নেই।</p>
              )}
            </div>
          </section>
        </>
      )}

      {tab === "sessions" && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="px-4 pb-3 pt-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Today activity</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">{snapshot.date}</p>
              </div>
              <span className="text-[11px] font-medium text-slate-400">Live clinic activity</span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <p className="text-xl font-semibold tabular-nums text-slate-950">{activityCounts.patients}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">Patients</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                <p className="text-xl font-semibold tabular-nums text-emerald-700">{activityCounts.sessions}</p>
                <p className="mt-0.5 text-[10px] text-emerald-700">Sessions</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3 ring-1 ring-blue-100">
                <p className="text-xl font-semibold tabular-nums text-blue-700">{activityCounts.appointments}</p>
                <p className="mt-0.5 text-[10px] text-blue-700">Appointments</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
              <div>
                <p className="text-lg font-semibold tabular-nums text-blue-700">{snapshot.appointmentCounts.open}</p>
                <p className="text-[10px] text-slate-500">Open</p>
              </div>
              <div>
                <p className="text-lg font-semibold tabular-nums text-emerald-700">{snapshot.appointmentCounts.completed}</p>
                <p className="text-[10px] text-slate-500">Completed</p>
              </div>
              <div>
                <p className="text-lg font-semibold tabular-nums text-red-600">{snapshot.appointmentCounts.missed}</p>
                <p className="text-[10px] text-slate-500">Missed</p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100">
            {snapshot.appointments.slice(0, 40).map((item) => (
              <div
                key={`${item.department}-${item.appointmentId}`}
                className="flex min-h-[68px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.time} · {item.patientName}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {item.department} · {item.therapist || "Unassigned"}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${appointmentClass(item.status)}`}>
                  {item.status || "Scheduled"}
                </span>
              </div>
            ))}
            {snapshot.appointments.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-slate-400">আজ কোনো appointment নেই।</p>
            )}
          </div>
        </section>
      )}

      {tab === "summary" && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Attendance summary</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">{snapshot.date} · visible staff only</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${summary.absenceRate > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
              {summary.absenceRate}% absent
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["Expected", summary.expected],
              ["Present", summary.present],
              ["Working", summary.working],
              ["On break", summary.onBreak],
              ["Checked out", summary.checkedOut],
              ["Not in", summary.notIn],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <p className="text-lg font-semibold tabular-nums text-slate-950">{value}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between px-3 py-3 text-xs">
              <span className="text-slate-500">Earliest check-in</span>
              <span className="font-semibold text-slate-900">{summary.earliestStart}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-3 text-xs">
              <span className="text-slate-500">Latest check-out</span>
              <span className="font-semibold text-slate-900">{summary.latestEnd}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-3 text-xs">
              <span className="text-slate-500">Staff currently on break</span>
              <span className="font-semibold text-amber-700">{summary.onBreak}</span>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-5 text-slate-400">
            Summary uses only attendance records visible to your current role and department scope. Bulk attendance actions are intentionally unavailable.
          </p>
        </section>
      )}
    </div>
  );
}
