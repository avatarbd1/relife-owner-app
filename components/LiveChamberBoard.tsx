"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";
import type { ChamberSnapshot, ChamberSession } from "@/lib/webos/chamber";

type ActionState = { key: string; error: string };

function humanError(message: string): string {
  if (message === "PATIENT_GENDER_REQUIRED") return "Gender set না থাকায় bed assign করা যাচ্ছে না।";
  if (message === "THERAPIST_NOT_ASSIGNED") return "এই patient আপনার assigned/cross-cover patient নয়।";
  if (message === "CHAMBER_SESSION_NOT_WAITING") return "Patient আর waiting অবস্থায় নেই। Refresh করে আবার দেখুন।";
  if (message.startsWith("CHAMBER_CAPACITY:")) return message.replace("CHAMBER_CAPACITY:", "");
  if (message.startsWith("RESOURCE_BUSY:")) {
    const [, resource, patient] = message.split(":");
    return `${resource} এখন ${patient || "অন্য patient"}-এর কাছে busy।`;
  }
  if (message === "CHAMBER_SESSION_NOT_RUNNING") return "Patient এখন treatment station-এ running নয়।";
  return message.replaceAll("_", " ");
}

function elapsed(startedAt: string, now: number): string {
  if (!startedAt) return "—";
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "—";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function remaining(expectedAt: string, now: number): { text: string; overtime: boolean } {
  if (!expectedAt) return { text: "", overtime: false };
  const end = Date.parse(expectedAt);
  if (!Number.isFinite(end)) return { text: "", overtime: false };
  const diff = Math.ceil((end - now) / 1000);
  const overtime = diff < 0;
  const abs = Math.abs(diff);
  return {
    text: `${overtime ? "+" : ""}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`,
    overtime,
  };
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
  const [editing, setEditing] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/chamber", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.ok && payload.snapshot) setSnapshot(payload.snapshot);
    } catch {
      // Keep the last good board during a transient network failure.
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

  const machineName = useMemo(
    () => new Map(snapshot.machines.map((item) => [item.resource.resourceId, item.resource.resourceName])),
    [snapshot.machines]
  );

  async function post(key: string, body: Record<string, unknown>) {
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

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-950 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">Live chamber</p>
            <h2 className="mt-1 text-lg font-semibold">4 Beds + Traction</h2>
            <p className="mt-1 text-xs text-slate-300">Receive → tap preferred bed → Start → tap machine/step → complete</p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
            </span>
            <p className="mt-2 text-[10px] text-slate-400">Auto refresh 5s</p>
          </div>
        </div>
      </section>

      {action.error && (
        <div className="relife-error-shake rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100">
          {action.error}
        </div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Treatment stations</h3>
            <p className="text-[11px] text-slate-500">Room gender changes automatically from current occupancy</p>
          </div>
          <span className="text-[11px] text-slate-400">{snapshot.date}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {snapshot.stations.map((station) => (
            <StationCard
              key={station.resource.resourceId}
              station={station}
              snapshot={snapshot}
              machineName={machineName}
              now={now}
              busyKey={action.key}
              editing={editing}
              setEditing={setEditing}
              onPost={post}
            />
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Waiting & reception</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Today&apos;s patient flow</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{snapshot.queue.length}</span>
        </div>
        {snapshot.queue.length > 0 ? snapshot.queue.map((item) => (
          <div key={item.appointmentId} className="border-t border-slate-100 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.time} · {item.patientName || item.patientId}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.patientId} · {item.therapist || "Unassigned"}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${genderTone(item.gender)}`}>{item.gender || "Gender needed"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(item.sessionStatus || item.appointmentStatus)}`}>{item.sessionStatus || item.appointmentStatus}</span>
                  {item.recommendedStationId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Preferred {item.recommendedStationId}</span>}
                </div>
                {item.allocationWarning && <p className="mt-2 text-[11px] text-amber-700">{item.allocationWarning}</p>}
              </div>
              <div className="shrink-0">
                {!item.sessionId && snapshot.permissions.receive && (
                  <button type="button" disabled={action.key === `receive:${item.appointmentId}`} onClick={() => post(`receive:${item.appointmentId}`, { action: "receive", appointmentId: item.appointmentId })} className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">
                    {action.key === `receive:${item.appointmentId}` ? "…" : "Receive"}
                  </button>
                )}
                {item.sessionId && item.sessionStatus === "Waiting" && snapshot.permissions.run && (
                  <button type="button" disabled={action.key === `start:${item.sessionId}` || action.key.startsWith(`prefer:${item.appointmentId}:`)} onClick={() => post(`start:${item.sessionId}`, { action: "start", sessionId: item.sessionId })} className="min-h-10 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
                    {action.key === `start:${item.sessionId}` ? "…" : "Start"}
                  </button>
                )}
              </div>
            </div>

            {item.sessionId && item.sessionStatus === "Waiting" && snapshot.permissions.run && (
              <WaitingBedPicker item={item} snapshot={snapshot} busyKey={action.key} onPost={post} />
            )}
          </div>
        )) : <p className="border-t border-slate-100 px-4 py-7 text-center text-sm text-slate-400">Waiting patient নেই।</p>}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="px-4 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">Machine availability</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">Busy resource cannot be assigned to another patient</p>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3">
          {snapshot.machines.map((machine) => {
            const timer = remaining(machine.session?.expectedReleaseAt || "", now);
            return (
              <div key={machine.resource.resourceId} className="bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-slate-900">{machine.resource.resourceName}</p>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${machine.session ? "bg-amber-400" : "bg-emerald-500"}`} />
                </div>
                {machine.session ? (
                  <>
                    <p className="mt-1 truncate text-[10px] text-slate-500">{machine.session.patientName}</p>
                    <p className={`mt-0.5 text-[10px] font-semibold ${timer.overtime ? "text-red-600" : "text-amber-700"}`}>{timer.text ? `${timer.overtime ? "Over " : "Left "}${timer.text}` : "Busy"}</p>
                  </>
                ) : <p className="mt-1 text-[10px] font-semibold text-emerald-700">Free</p>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function WaitingBedPicker({
  item,
  snapshot,
  busyKey,
  onPost,
}: {
  item: ChamberSnapshot["queue"][number];
  snapshot: ChamberSnapshot;
  busyKey: string;
  onPost: (key: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const options = snapshot.stations.map((station) => {
    const occupiedByOther = Boolean(station.session && station.session.sessionId !== item.sessionId);
    const isTraction = station.resource.resourceId === "TRACTION-BED";
    const wrongGender = !isTraction && Boolean(station.roomGender && station.roomGender !== item.gender);
    const missingGender = !isTraction && !item.gender;
    const disabled = occupiedByOther || wrongGender || missingGender;
    const subtitle = occupiedByOther
      ? `Busy · ${station.session?.patientName || "patient"}`
      : wrongGender
        ? `${station.roomGender} room`
        : missingGender
          ? "Gender needed"
          : station.resource.roomId;
    return {
      value: station.resource.resourceId,
      label: station.resource.resourceName,
      subtitle,
      disabled,
      tone: isTraction ? "amber" as const : "emerald" as const,
    };
  });

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-slate-700">Preferred bed · tap before Start</p>
        {busyKey.startsWith(`prefer:${item.appointmentId}:`) && <span className="text-[10px] font-medium text-blue-700">Saving…</span>}
      </div>
      <TapChoice
        value={item.recommendedStationId}
        options={options}
        columns={options.length >= 4 ? 4 : 2}
        compact
        onChange={(stationId) => {
          if (!stationId || stationId === item.recommendedStationId) return;
          void onPost(`prefer:${item.appointmentId}:${stationId}`, {
            action: "prefer_station",
            appointmentId: item.appointmentId,
            stationId,
          });
        }}
      />
      <p className="mt-2 text-[10px] leading-4 text-slate-400">Preference is not a force override. Start re-checks live gender, occupancy and capacity; an unsafe bed will not be used.</p>
    </div>
  );
}

function StationCard({
  station,
  snapshot,
  machineName,
  now,
  busyKey,
  editing,
  setEditing,
  onPost,
}: {
  station: ChamberSnapshot["stations"][number];
  snapshot: ChamberSnapshot;
  machineName: Map<string, string>;
  now: number;
  busyKey: string;
  editing: string;
  setEditing: (value: string) => void;
  onPost: (key: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const session = station.session;
  const timer = remaining(session?.expectedReleaseAt || "", now);
  const isEditing = Boolean(session && editing === session.sessionId);
  const isTraction = station.resource.resourceId === "TRACTION-BED";

  return (
    <article className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${session ? "ring-emerald-200" : "ring-slate-200"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{station.resource.resourceName}</h4>
            {!isTraction && <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${genderTone(station.roomGender)}`}>{station.roomGender || "Neutral room"}</span>}
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">{station.resource.roomId}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${session ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{session ? "Occupied" : "Free"}</span>
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

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniMetric label="Running" value={elapsed(session.startedAt, now)} />
            <MiniMetric label="Step" value={session.currentStep || "Setup"} />
            <MiniMetric label={timer.overtime ? "Over" : "Step left"} value={timer.text || "—"} tone={timer.overtime ? "danger" : "default"} />
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Current machine/resource</p>
            <p className="mt-1 text-xs font-semibold text-slate-800">{session.currentResourceId ? machineName.get(session.currentResourceId) || session.currentResourceId : "No machine locked"}</p>
          </div>

          {snapshot.permissions.run && (
            <div className="mt-3">
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(isEditing ? "" : session.sessionId)} className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                  {isEditing ? "Close" : "Next step / move"}
                </button>
                <button type="button" disabled={busyKey === `complete:${session.sessionId}`} onClick={() => onPost(`complete:${session.sessionId}`, { action: "complete", sessionId: session.sessionId })} className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">
                  {busyKey === `complete:${session.sessionId}` ? "…" : "Complete"}
                </button>
              </div>
              {isEditing && <StepEditor session={session} snapshot={snapshot} busyKey={busyKey} onPost={onPost} onDone={() => setEditing("")} />}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-7 text-center">
          <p className="text-sm font-medium text-slate-400">Available</p>
          {!isTraction && station.roomGender && <p className="mt-1 text-[10px] text-slate-400">Next patient must be {station.roomGender}</p>}
        </div>
      )}
    </article>
  );
}

function StepEditor({
  session,
  snapshot,
  busyKey,
  onPost,
  onDone,
}: {
  session: ChamberSession;
  snapshot: ChamberSnapshot;
  busyKey: string;
  onPost: (key: string, body: Record<string, unknown>) => Promise<void>;
  onDone: () => void;
}) {
  const [step, setStep] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [stationId, setStationId] = useState(session.stationId);
  const [duration, setDuration] = useState("10");
  const key = `step:${session.sessionId}`;

  const bedOptions = snapshot.stations.map((item) => {
    const occupiedByOther = Boolean(item.session && item.session.sessionId !== session.sessionId);
    const isTraction = item.resource.resourceId === "TRACTION-BED";
    const wrongGender = !isTraction && Boolean(item.roomGender && item.roomGender !== session.gender);
    const missingGender = !isTraction && !session.gender;
    const blocked = occupiedByOther || wrongGender || missingGender;
    const reason = occupiedByOther
      ? `Busy · ${item.session?.patientName || "patient"}`
      : wrongGender
        ? `${item.roomGender} room`
        : missingGender
          ? "Gender needed"
          : item.resource.roomId;
    return {
      value: item.resource.resourceId,
      label: item.resource.resourceName,
      subtitle: reason,
      disabled: blocked,
      tone: isTraction ? "amber" as const : "emerald" as const,
    };
  });

  const machineOptions = [
    { value: "", label: "No machine", subtitle: "Manual / exercise", tone: "slate" as const },
    ...snapshot.machines.map((item) => {
      const busyOther = Boolean(item.session && item.session.sessionId !== session.sessionId);
      return {
        value: item.resource.resourceId,
        label: item.resource.resourceName,
        subtitle: busyOther ? `Busy · ${item.session?.patientName || "patient"}` : "Available",
        disabled: busyOther,
        tone: "blue" as const,
      };
    }),
  ];

  const quickSteps = useMemo(() => {
    const values = ["Exercise", "Manual Therapy", "Traction", ...snapshot.machines.map((item) => item.resource.resourceName)];
    return [...new Set(values)].slice(0, 10);
  }, [snapshot.machines]);

  async function submit() {
    if (!step.trim()) return;
    await onPost(key, {
      action: "step",
      sessionId: session.sessionId,
      step,
      resourceId,
      stationId,
      durationMin: Number(duration || 0),
    });
    onDone();
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div>
        <p className="mb-2 text-[11px] font-semibold text-slate-600">Treatment step · tap common option</p>
        <div className="flex flex-wrap gap-1.5">
          {quickSteps.map((item) => (
            <button key={item} type="button" onClick={() => { setStep(item); haptic("tap"); }} className={`min-h-9 rounded-lg border px-2.5 text-[10px] font-semibold ${step === item ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
              {item}
            </button>
          ))}
        </div>
        <input value={step} onChange={(event) => setStep(event.target.value)} placeholder="Other step — type only if needed" className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" />
      </div>

      <TapChoice label="Bed / station" value={stationId} columns={bedOptions.length >= 4 ? 4 : 2} options={bedOptions} onChange={(value) => value && setStationId(value)} tone="emerald" />

      <TapChoice
        label="Machine / resource"
        value={resourceId}
        columns={machineOptions.length >= 4 ? 4 : 2}
        options={machineOptions}
        onChange={(value) => {
          setResourceId(value);
          const machine = snapshot.machines.find((item) => item.resource.resourceId === value);
          if (machine && !step.trim()) setStep(machine.resource.resourceName);
        }}
        tone="blue"
      />

      <div>
        <p className="mb-2 text-[11px] font-semibold text-slate-600">Planned minutes</p>
        <div className="grid grid-cols-5 gap-1.5">
          {["5", "10", "15", "20", "30"].map((item) => (
            <button key={item} type="button" onClick={() => { setDuration(item); haptic("tap"); }} className={`min-h-10 rounded-lg border text-[11px] font-semibold ${duration === item ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
              {item}m
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          Custom
          <input type="number" min="0" max="180" value={duration} onChange={(event) => setDuration(event.target.value)} className="min-h-10 w-24 rounded-lg border border-slate-200 bg-white px-2 text-xs" />
          min
        </label>
      </div>

      <button type="button" disabled={!step.trim() || !stationId || busyKey === key} onClick={submit} className="min-h-11 w-full rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40">
        {busyKey === key ? "Saving…" : "Start step / move patient"}
      </button>
    </div>
  );
}

function MiniMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
      <p className={`truncate text-sm font-semibold tabular-nums ${tone === "danger" ? "text-red-600" : "text-slate-900"}`}>{value}</p>
      <p className="mt-0.5 truncate text-[9px] text-slate-400">{label}</p>
    </div>
  );
}
