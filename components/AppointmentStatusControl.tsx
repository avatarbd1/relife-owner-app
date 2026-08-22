"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

const STATUSES = [
  "Scheduled",
  "Arrived",
  "Waiting",
  "In Treatment",
  "Completed",
  "No-show",
  "Cancelled",
] as const;

type AppointmentStatus = (typeof STATUSES)[number];
type UndoState = { from: AppointmentStatus; to: AppointmentStatus };

function contextualActions(status: string): AppointmentStatus[] {
  const value = status.trim().toLowerCase();
  if (value === "scheduled") return ["Arrived", "No-show", "Cancelled"];
  if (value === "arrived") return ["In Treatment", "Waiting", "Completed"];
  if (value === "waiting") return ["In Treatment", "Completed", "Cancelled"];
  if (value === "in treatment") return ["Completed", "Waiting"];
  return [];
}

function actionStyle(status: AppointmentStatus): string {
  if (status === "Completed") return "border-emerald-200 bg-emerald-100 text-emerald-800";
  if (status === "No-show" || status === "Cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (status === "Arrived" || status === "In Treatment") return "border-amber-200 bg-amber-100 text-amber-800";
  return "border-slate-200 bg-white text-slate-700";
}

function asStatus(value: string): AppointmentStatus | null {
  return STATUSES.find((status) => status === value) || null;
}

export default function AppointmentStatusControl({
  appointmentId,
  department,
  currentStatus,
}: {
  appointmentId: string;
  department: "Physio" | "Dental";
  currentStatus: string;
}) {
  const router = useRouter();
  const [selectedStatus, setSelectedStatus] = useState(currentStatus || "Scheduled");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [completionRecorded, setCompletionRecorded] = useState(false);
  const actions = useMemo(() => contextualActions(currentStatus), [currentStatus]);
  const completionLocked = completionRecorded || currentStatus.trim().toLowerCase() === "completed";

  useEffect(() => {
    if (!undoState) return;
    const timer = window.setTimeout(() => setUndoState(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [undoState]);

  async function save(nextStatus: string) {
    if (!nextStatus || nextStatus === currentStatus || busy) return;
    const next = asStatus(nextStatus);
    const previous = asStatus(currentStatus || "Scheduled");
    if (!next || !previous) return;
    if (completionLocked) {
      setMessage("✕ Completed appointment requires correction/reopen workflow");
      return;
    }
    if (next === "Completed") {
      const confirmed = window.confirm(
        "Complete appointment? This records completion evidence and cannot use instant Undo. A later reopen must use a correction workflow."
      );
      if (!confirmed) return;
    }

    setBusy(nextStatus);
    setMessage(null);
    setUndoState(null);
    try {
      const response = await fetch("/api/appointments/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId, department, status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "APPOINTMENT_STATUS_FAILED");
      }
      haptic("success");
      setSelectedStatus(nextStatus);
      if (next === "Completed") {
        setCompletionRecorded(true);
        setMessage("✓ Completed · correction required to reopen");
      } else {
        setUndoState({ from: previous, to: next });
        setMessage(`✓ ${next}`);
      }
      router.refresh();
    } catch (error) {
      haptic("error");
      setMessage(`✕ ${error instanceof Error ? error.message : "Update failed"}`);
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    if (!undoState || busy) return;
    const pending = undoState;
    setBusy("undo");
    setMessage(null);
    try {
      const response = await fetch("/api/appointments/status/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appointmentId,
          department,
          expectedCurrentStatus: pending.to,
          restoreStatus: pending.from,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "APPOINTMENT_UNDO_FAILED");
      }
      haptic("success");
      setSelectedStatus(pending.from);
      setUndoState(null);
      setMessage(`✓ Restored to ${pending.from}`);
      router.refresh();
    } catch (error) {
      haptic("error");
      setUndoState(null);
      setMessage(`✕ ${error instanceof Error ? error.message : "Undo failed"}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3" data-swipe-nav-ignore>
      {actions.length > 0 && !completionLocked && (
        <div className="flex flex-wrap gap-2">
          {actions.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy !== null}
              onClick={() => save(status)}
              className={`relife-interactive inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${actionStyle(status)}`}
            >
              {busy === status && <Spinner size="sm" label={`Saving ${status}`} />}
              {busy === status ? "Saving" : status}
            </button>
          ))}
        </div>
      )}

      {!completionLocked ? (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-500">More status options</summary>
          <div className="mt-2 flex items-center gap-2">
            <select
              aria-label="Appointment status"
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              disabled={busy !== null}
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-700"
            >
              {STATUSES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy !== null || selectedStatus === currentStatus}
              onClick={() => save(selectedStatus)}
              className="relife-interactive inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-800 px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy === selectedStatus && <Spinner size="sm" className="border-white/40 border-t-white" label="Updating status" />}
              Update
            </button>
          </div>
        </details>
      ) : (
        <p className="mt-2 text-[10px] font-medium text-slate-500">Completed is locked from instant status rollback; use correction/reopen workflow.</p>
      )}

      {message && (
        <div
          className={`mt-2 flex min-h-10 items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[10px] font-medium ${
            message.startsWith("✓")
              ? "relife-success-flash bg-emerald-100 text-emerald-700"
              : "relife-error-shake bg-red-100 text-red-700"
          }`}
          role="status"
        >
          <span>{message}</span>
          {undoState && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void undo()}
              className="min-h-8 shrink-0 rounded-md bg-white px-3 text-[10px] font-bold text-blue-800 ring-1 ring-blue-200 disabled:opacity-50"
            >
              {busy === "undo" ? "Undoing…" : "UNDO"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
