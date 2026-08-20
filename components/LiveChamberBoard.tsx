"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MachineOperationsPanel from "@/components/MachineOperationsPanel";
import { haptic } from "@/lib/interactions";
import type { ChamberSnapshot } from "@/lib/webos/chamber";

type ActionState = { key: string; error: string };

function humanError(message: string): string {
  if (message === "PATIENT_GENDER_REQUIRED") return "Gender set না থাকায় treatment শুরু করা যাচ্ছে না।";
  if (message === "THERAPIST_NOT_ASSIGNED") return "এই patient assigned therapist-এর নয়।";
  if (message === "MACHINE_STILL_RUNNING") return "Machine এখনো running। আগে machine Finish করুন।";
  if (message.startsWith("CHAMBER_CAPACITY:")) return message.replace("CHAMBER_CAPACITY:", "");
  if (message.startsWith("RESOURCE_BUSY:")) {
    const [, resource, patient] = message.split(":");
    return `${resource} এখন ${patient || "অন্য patient"}-এর কাছে busy।`;
  }
  return message.replaceAll("_", " ");
}

function elapsed(startedAt: string, now: number): string {
  if (!startedAt) return "—";
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "—";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function genderTone(gender: string): string {
  if (gender === "Female") return "bg-fuchsia-50 text-fuchsia-700";
  if (gender === "Male") return "bg-sky-50 text-sky-700";
  if (gender === "Mixed") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-500";
}

function statusTone(status: string): string {
  if (status === "In Treatment") return "bg-emerald-50 text-emerald-700";
  if (status === "Waiting") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export default function LiveChamberBoard({ initial }: { initial: ChamberSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const [action, setAction] = useState<ActionState>({ key: "", error: "" });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/chamber", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok && payload.snapshot) setSnapshot(payload.snapshot);
    } catch {
      // Keep last good operating board during a transient read failure.
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const poller = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(poller);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function post(key: string, body: Record<string, unknown>) {
    if (action.key) return;
    setAction({ key, error: "" });
    try {
      const response = await fetch("/api/chamber", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "CHAMBER_ACTION_FAILED");
      haptic("success");
      await refresh();
      setAction({ key: "", error: "" });
    } catch (error) {
      haptic("error");
      setAction({ key: "", error: humanError(error instanceof Error ? error.message : "CHAMBER_ACTION_FAILED") });
    }
  }

  const generalStations = useMemo(
    () => snapshot.stations.filter((item) => /^BED-[1-4]$/.test(item.resource.resourceId)),
    [snapshot.stations]
  );
  const occupied = generalStations.filter((item) => item.session).length;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-950 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">Live operation</p>
            <h2 className="mt-1 text-lg font-semibold">4 General Beds · machines separate</h2>
            <p className="mt-1 text-xs leading-5 text-slate-300">Reception: Arrived · Therapist: Start / Complete · Machine use: shared staff</p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
            </span>
            <p className="mt-2 text-[10px] text-slate-400">{occupied}/4 general beds</p>
          </div>
        </div>
      </section>

      {action.error ? (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100">
          {action.error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Arrivals & waiting</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">No bed is reserved here. General bed is chosen only when treatment actually starts.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{snapshot.queue.length}</span>
        </div>
        {snapshot.queue.length > 0 ? snapshot.queue.map((item) => (
          <div key={item.appointmentId} className="border-t border-slate-100 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.time} · {item.patientName || item.patientId}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.patientId} · {item.therapist || "Any therapist"}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${genderTone(item.gender)}`}>{item.gender || "Gender needed"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(item.sessionStatus || item.appointmentStatus)}`}>{item.sessionStatus || item.appointmentStatus}</span>
                </div>
                {item.allocationWarning && !/Receive patient first/i.test(item.allocationWarning) ? (
                  <p className="mt-2 text-[11px] text-amber-700">{item.allocationWarning}</p>
                ) : null}
              </div>
              <div className="shrink-0">
                {!item.sessionId && snapshot.permissions.receive ? (
                  <button
                    type="button"
                    disabled={Boolean(action.key)}
                    onClick={() => void post(`receive:${item.appointmentId}`, { action: "receive", appointmentId: item.appointmentId })}
                    className="min-h-10 rounded-xl bg-amber-500 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {action.key === `receive:${item.appointmentId}` ? "…" : "Arrived"}
                  </button>
                ) : null}
                {item.sessionId && item.sessionStatus === "Waiting" && snapshot.permissions.run ? (
                  <button
                    type="button"
                    disabled={Boolean(action.key)}
                    onClick={() => void post(`start:${item.sessionId}`, { action: "start", sessionId: item.sessionId })}
                    className="min-h-10 rounded-xl bg-violet-700 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {action.key === `start:${item.sessionId}` ? "…" : "Start Treatment"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )) : (
          <p className="border-t border-slate-100 px-4 py-7 text-center text-sm text-slate-400">Waiting patient নেই।</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">General treatment beds</h3>
            <p className="text-[11px] text-slate-500">Room gender follows actual occupancy, not a fixed booking bed.</p>
          </div>
          <span className="text-[11px] text-slate-400">{snapshot.date}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {generalStations.map((station) => {
            const session = station.session;
            return (
              <article key={station.resource.resourceId} className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${session ? "ring-emerald-200" : "ring-slate-200"}`}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">{station.resource.resourceName}</h4>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${genderTone(station.roomGender)}`}>{station.roomGender || "Neutral room"}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-500">{station.resource.roomId}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${session ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{session ? "In treatment" : "Available"}</span>
                </div>
                {session ? (
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-slate-950">{session.patientName}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{session.patientId} · {session.therapist || "Unassigned"}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${genderTone(session.gender)}`}>{session.gender || "?"}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Actual treatment time</p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{elapsed(session.startedAt, now)}</p>
                      </div>
                      {snapshot.permissions.run ? (
                        <button
                          type="button"
                          disabled={Boolean(action.key)}
                          onClick={() => void post(`complete:${session.sessionId}`, { action: "complete", sessionId: session.sessionId })}
                          className="min-h-10 rounded-xl bg-teal-700 px-3 text-[11px] font-bold text-white disabled:opacity-50"
                        >
                          {action.key === `complete:${session.sessionId}` ? "…" : "Complete Treatment"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-7 text-center text-sm font-medium text-slate-400">Free</div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <MachineOperationsPanel onTreatmentChanged={refresh} />
    </div>
  );
}
