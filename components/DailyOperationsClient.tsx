"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AttendanceRecord = {
  checkIn: string;
  breakOut: string;
  breakIn: string;
  checkOut: string;
  workingHours: number | null;
  status: string;
};

type Snapshot = {
  date: string;
  attendance: {
    self: AttendanceRecord | null;
    team: Array<{
      staffId: string;
      fullName: string;
      role: string;
      department: string;
      state: "not_in" | "working" | "break" | "checked_out";
      checkIn: string;
      checkOut: string;
    }>;
    location: { configured: boolean; radiusMeters: number; maxAccuracyMeters: number };
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
  appointmentCounts: { total: number; completed: number; open: number; missed: number };
};

type Action = "check_in" | "break_out" | "break_in" | "check_out";

const actionLabel: Record<Action, string> = {
  check_in: "Check In",
  break_out: "Break Out",
  break_in: "Break In",
  check_out: "Check Out",
};

const errorText: Record<string, string> = {
  ATTENDANCE_LOCATION_NOT_CONFIGURED: "Clinic location config এখনও Web app-এ সেট করা হয়নি।",
  ATTENDANCE_LOCATION_INVALID: "Location পাওয়া যায়নি। GPS ও Precise location চালু করে আবার চেষ্টা করুন।",
  ATTENDANCE_LOCATION_ACCURACY: "GPS accuracy যথেষ্ট ভালো নয়। App এখন ভালো GPS fix-এর জন্য অপেক্ষা করবে—খোলা জায়গায় আবার চেষ্টা করুন।",
  ATTENDANCE_OUTSIDE_CLINIC: "Clinic attendance radius-এর বাইরে আছেন।",
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

function location(maxAccuracyMeters: number): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("ATTENDANCE_LOCATION_INVALID"));

    let best: { latitude: number; longitude: number; accuracy: number } | null = null;
    let watchId: number | null = null;
    let timerId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timerId !== null) window.clearTimeout(timerId);
    };

    const accept = (point: { latitude: number; longitude: number; accuracy: number }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(point);
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("ATTENDANCE_LOCATION_INVALID"));
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        if (!best || point.accuracy < best.accuracy) best = point;
        if (point.accuracy <= maxAccuracyMeters) accept(point);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) fail();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    timerId = window.setTimeout(() => {
      if (best) accept(best);
      else fail();
    }, 25000);
  });
}

function stateLabel(state: Snapshot["attendance"]["team"][number]["state"]) {
  if (state === "working") return "Working";
  if (state === "break") return "On break";
  if (state === "checked_out") return "Checked out";
  return "Not in";
}

function stateClass(state: Snapshot["attendance"]["team"][number]["state"]) {
  if (state === "working") return "bg-emerald-50 text-emerald-700";
  if (state === "break") return "bg-amber-50 text-amber-700";
  if (state === "checked_out") return "bg-slate-100 text-slate-600";
  return "bg-red-50 text-red-700";
}

export default function DailyOperationsClient({ snapshot }: { snapshot: Snapshot }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: Action) {
    setBusy(action);
    setMessage(null);
    try {
      let position: Awaited<ReturnType<typeof location>> | undefined;
      if (action === "check_in") {
        position = await location(snapshot.attendance.location.maxAccuracyMeters);
      }
      const response = await fetch("/api/attendance/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, location: position }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "ATTENDANCE_ACTION_FAILED");
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

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">My attendance</p>
            <h2 className="mt-1 text-lg font-semibold">{self?.status || "Not checked in"}</h2>
            <p className="mt-1 text-xs text-slate-300">
              {self?.checkIn ? `In ${self.checkIn}` : "আজকের attendance শুরু হয়নি"}
              {self?.checkOut ? ` · Out ${self.checkOut}` : ""}
            </p>
          </div>
          {self?.workingHours !== null && self?.workingHours !== undefined && (
            <span className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold">{self.workingHours}h</span>
          )}
        </div>

        {actions.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {actions.map((action) => {
              const isCheckIn = action === "check_in";
              const disabled = busy !== null || (isCheckIn && !snapshot.attendance.location.configured);
              return (
                <button
                  key={action}
                  type="button"
                  disabled={disabled}
                  onClick={() => act(action)}
                  className="min-h-12 select-none rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy === action ? (isCheckIn ? "Getting GPS…" : "Saving…") : actionLabel[action]}
                </button>
              );
            })}
          </div>
        )}
        {!snapshot.attendance.location.configured && !self?.checkIn && (
          <p className="mt-3 rounded-xl bg-amber-400/15 p-3 text-xs text-amber-200">
            Check In locked: Render-এ clinic latitude/longitude attendance config লাগবে। Guess করা location ব্যবহার করা হচ্ছে না।
          </p>
        )}
        {message && (
          <p className={`mt-3 text-xs ${message.startsWith("✓") ? "text-emerald-300" : "text-red-300"}`} role="status">
            {message}
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Today flow</h2>
            <p className="text-[11px] text-slate-500">Appointments · {snapshot.date}</p>
          </div>
          <span className="text-xs font-medium text-slate-500">{snapshot.appointmentCounts.total} total</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold text-slate-900">{snapshot.appointmentCounts.open}</p><p className="text-[10px] text-slate-500">Open</p></div>
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-lg font-bold text-emerald-700">{snapshot.appointmentCounts.completed}</p><p className="text-[10px] text-emerald-600">Completed</p></div>
          <div className="rounded-xl bg-red-50 p-3"><p className="text-lg font-bold text-red-700">{snapshot.appointmentCounts.missed}</p><p className="text-[10px] text-red-600">Missed</p></div>
        </div>
        <div className="mt-3 space-y-2">
          {snapshot.appointments.slice(0, 40).map((item) => (
            <div key={`${item.department}-${item.appointmentId}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.time} · {item.patientName}</p>
                <p className="truncate text-[11px] text-slate-500">{item.department} · {item.therapist || "Unassigned"}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">{item.status}</span>
            </div>
          ))}
          {snapshot.appointments.length === 0 && <p className="py-5 text-center text-sm text-slate-400">আজ কোনো appointment নেই।</p>}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Staff readiness</h2>
            <p className="text-[11px] text-slate-500">Live 03_Attendance</p>
          </div>
          <span className="text-xs text-slate-500">{snapshot.attendance.team.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {snapshot.attendance.team.map((staff) => (
            <div key={staff.staffId} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{staff.fullName}</p>
                <p className="truncate text-[11px] text-slate-500">{staff.role} · {staff.department}{staff.checkIn ? ` · In ${staff.checkIn}` : ""}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${stateClass(staff.state)}`}>{stateLabel(staff.state)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
