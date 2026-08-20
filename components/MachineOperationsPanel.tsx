"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { haptic } from "@/lib/interactions";

type Machine = {
  resourceId: string;
  resourceName: string;
  durationMin: number;
  traction: boolean;
  busy: boolean;
  sessionId: string;
  patientId: string;
  patientName: string;
  expectedReleaseAt: string;
};

type Session = {
  sessionId: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  therapist: string;
  status: "Waiting" | "In Treatment" | "Completed" | "Cancelled";
  stationId: string;
  currentResourceId: string;
  currentStep: string;
  expectedReleaseAt: string;
};

type Snapshot = {
  date: string;
  canOperate: boolean;
  canRunTreatment: boolean;
  machines: Machine[];
  sessions: Session[];
};

function remaining(expectedAt: string, now: number): string {
  if (!expectedAt) return "";
  const end = Date.parse(expectedAt);
  if (!Number.isFinite(end)) return "";
  const seconds = Math.ceil((end - now) / 1000);
  if (seconds <= 0) return `+${Math.floor(Math.abs(seconds) / 60)}m`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function humanError(message: string): string {
  if (message.startsWith("RESOURCE_BUSY:")) {
    const [, resource, patient] = message.split(":");
    return `${resource} এখন ${patient || "অন্য patient"}-এর কাছে busy।`;
  }
  if (message.startsWith("MACHINE_ALREADY_RUNNING:")) return "এই patient-এর আরেকটি machine এখনো running। আগে Finish করুন।";
  if (message === "MACHINE_STILL_RUNNING") return "Machine এখনো running। আগে Finish করুন।";
  if (message === "THERAPIST_NOT_ASSIGNED") return "Assigned therapist ছাড়া treatment Start/Complete করা যাবে না।";
  return message.replaceAll("_", " ");
}

export default function MachineOperationsPanel({ onTreatmentChanged }: { onTreatmentChanged?: () => Promise<void> | void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/chamber/machines", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok && payload.snapshot) setSnapshot(payload.snapshot as Snapshot);
    } catch {
      // Keep last-known machine board during transient read failures.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const poller = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(poller);
    };
  }, [refresh]);

  const machineById = useMemo(
    () => new Map((snapshot?.machines || []).map((machine) => [machine.resourceId, machine])),
    [snapshot]
  );

  async function machineAction(session: Session, machine: Machine, action: "start" | "finish") {
    if (busy) return;
    const key = `${action}:${session.sessionId}:${machine.resourceId}`;
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/chamber/machines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          sessionId: session.sessionId,
          resourceId: machine.resourceId,
          durationMin: machine.durationMin,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "MACHINE_ACTION_FAILED");
      haptic("success");
      await refresh();
      await onTreatmentChanged?.();
    } catch (actionError) {
      haptic("error");
      setError(humanError(actionError instanceof Error ? actionError.message : "MACHINE_ACTION_FAILED"));
    } finally {
      setBusy("");
    }
  }

  async function treatmentAction(session: Session, action: "start" | "complete") {
    if (busy) return;
    const key = `${action}:${session.sessionId}`;
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/chamber", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sessionId: session.sessionId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "CHAMBER_ACTION_FAILED");
      haptic("success");
      await refresh();
      await onTreatmentChanged?.();
    } catch (actionError) {
      haptic("error");
      setError(humanError(actionError instanceof Error ? actionError.message : "CHAMBER_ACTION_FAILED"));
    } finally {
      setBusy("");
    }
  }

  if (!snapshot) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">Machine board loading…</section>;
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">Live machine use</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Future booking does not reserve machines. Start only when the machine is actually attached.</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Shared</span>
        </div>
        {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3">
        {snapshot.machines.map((machine) => (
          <div key={machine.resourceId} className="bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-bold text-slate-900">{machine.resourceName}</p>
              <span className={`h-2 w-2 rounded-full ${machine.busy ? "bg-amber-400" : "bg-emerald-500"}`} />
            </div>
            {machine.busy ? (
              <>
                <p className="mt-1 truncate text-[10px] text-slate-500">{machine.patientName}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-amber-700">{remaining(machine.expectedReleaseAt, now) || "Busy"}</p>
              </>
            ) : (
              <p className="mt-1 text-[10px] font-semibold text-emerald-700">Available</p>
            )}
            <p className="mt-1 text-[9px] text-slate-400">{machine.traction ? "Traction · fixed 20 min reminder" : `Expected ${machine.durationMin} min`}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-slate-800">Active patients</p>
          <span className="text-[10px] text-slate-400">{snapshot.sessions.length}</span>
        </div>
        <div className="space-y-2">
          {snapshot.sessions.map((session) => {
            const currentMachine = session.currentResourceId ? machineById.get(session.currentResourceId) : undefined;
            return (
              <div key={session.sessionId} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-slate-900">{session.patientName || session.patientId}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">{session.status} · {session.stationId || (session.currentResourceId ? "Off general bed" : "Waiting")}</p>
                  </div>
                  {currentMachine ? (
                    <button
                      type="button"
                      disabled={!snapshot.canOperate || Boolean(busy)}
                      onClick={() => void machineAction(session, currentMachine, "finish")}
                      className="min-h-10 rounded-lg bg-amber-500 px-3 text-[10px] font-bold text-white disabled:opacity-40"
                    >
                      {busy.startsWith(`finish:${session.sessionId}:`) ? "…" : `Finish ${currentMachine.resourceName}`}
                    </button>
                  ) : null}
                </div>

                {!currentMachine && snapshot.canOperate ? (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                    {snapshot.machines.map((machine) => (
                      <button
                        key={machine.resourceId}
                        type="button"
                        disabled={Boolean(busy) || machine.busy}
                        onClick={() => void machineAction(session, machine, "start")}
                        className={`min-h-9 shrink-0 rounded-lg border px-2.5 text-[10px] font-bold disabled:opacity-35 ${machine.traction ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700"}`}
                      >
                        {machine.resourceName}
                      </button>
                    ))}
                  </div>
                ) : null}

                {snapshot.canRunTreatment && !session.currentResourceId ? (
                  <div className="mt-2 flex gap-2">
                    {session.status === "Waiting" ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void treatmentAction(session, "start")}
                        className="min-h-10 flex-1 rounded-lg bg-violet-700 px-3 text-[10px] font-bold text-white disabled:opacity-50"
                      >
                        {busy === `start:${session.sessionId}` ? "Starting…" : "Start Treatment"}
                      </button>
                    ) : null}
                    {session.status === "In Treatment" && !session.stationId ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void treatmentAction(session, "complete")}
                        className="min-h-10 flex-1 rounded-lg bg-teal-700 px-3 text-[10px] font-bold text-white disabled:opacity-50"
                      >
                        {busy === `complete:${session.sessionId}` ? "Completing…" : "Complete Treatment"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {snapshot.sessions.length === 0 ? <p className="py-3 text-center text-xs text-slate-400">No arrived/running patients.</p> : null}
        </div>
      </div>
    </section>
  );
}
