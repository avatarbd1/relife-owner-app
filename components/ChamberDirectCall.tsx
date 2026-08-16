"use client";

import { useMemo, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type CallTarget = {
  staffId: string;
  fullName: string;
  roles: string[];
};

type TargetOption = {
  value: string;
  label: string;
};

const QUICK_CALLS = [
  "Need assistance",
  "Patient ready",
  "Please come to Chamber",
  "Equipment help",
] as const;

const ROLE_LABELS: Array<{ role: string; label: string }> = [
  { role: "Receptionist", label: "Reception team" },
  { role: "Therapist", label: "Therapist team" },
  { role: "Manager", label: "Manager" },
  { role: "Owner", label: "Owner" },
];

export default function ChamberDirectCall({ targets }: { targets: CallTarget[] }) {
  const roleOptions = useMemo<TargetOption[]>(() => {
    return ROLE_LABELS.flatMap((item) =>
      targets.some((target) => target.roles.includes(item.role))
        ? [{ value: `ROLE:${item.role}`, label: item.label }]
        : []
    );
  }, [targets]);

  const staffOptions = useMemo<TargetOption[]>(
    () =>
      targets.map((target) => ({
        value: `STAFF:${target.staffId}`,
        label: `${target.fullName} · ${target.roles.join("/")}`,
      })),
    [targets]
  );

  const options = [...roleOptions, ...staffOptions];
  const [target, setTarget] = useState(options[0]?.value || "");
  const [reason, setReason] = useState<string>(QUICK_CALLS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCall() {
    if (!target || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const [kind, value] = target.split(":", 2);
      if (!value || !["STAFF", "ROLE"].includes(kind)) {
        throw new Error("Select who to call");
      }
      const body = [reason, note.trim()].filter(Boolean).join(" · ");
      const response = await fetch("/api/chamber/comms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          body,
          priority: "Urgent",
          // Existing Room_ID safely carries the call-routing marker; the alert
          // listener consumes it and ordinary Team chat still displays clean text.
          roomId: `CALL:${kind}:${value}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "CALL_FAILED");
      }
      setNote("");
      setMessage("✓ Direct call sent");
      haptic("success");
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Call failed"}`);
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-600">
            Direct call
          </p>
          <h2 className="mt-1 text-base font-bold text-slate-950">Call the right person</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Only the selected staff/person or role rings. Call alerts run 9:00 AM–9:00 PM Dhaka time.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700 ring-1 ring-red-100">
          10 sec
        </span>
      </div>

      {options.length > 0 ? (
        <>
          <label className="mt-4 block text-xs font-semibold text-slate-700">
            Who to call
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                haptic("tap");
              }}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            >
              {roleOptions.length > 0 && (
                <optgroup label="By role">
                  {roleOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </optgroup>
              )}
              {staffOptions.length > 0 && (
                <optgroup label="Specific staff">
                  {staffOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {QUICK_CALLS.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => {
                  setReason(item);
                  haptic("tap");
                }}
                className={`shrink-0 rounded-full border px-3 py-2 text-[11px] font-semibold ${
                  reason === item
                    ? "border-red-500 bg-red-50 text-red-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={180}
            placeholder="Optional: Bed 2 / patient name / what you need"
            className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
          />

          <button
            type="button"
            disabled={!target || busy}
            onClick={() => void sendCall()}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
          >
            {busy && <Spinner size="sm" className="border-white/40 border-t-white" label="Calling" />}
            {busy ? "Sending…" : "Call now"}
          </button>
          <p className="mt-2 text-[10px] leading-4 text-slate-400">
            Outside 9 AM–9 PM the message is saved in Team chat without ring, vibration or popup.
          </p>
          {message && (
            <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${message.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {message}
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
          No other active Physio staff is available for direct call.
        </p>
      )}
    </section>
  );
}
