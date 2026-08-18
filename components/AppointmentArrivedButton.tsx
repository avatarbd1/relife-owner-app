"use client";

import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

interface AppointmentArrivedButtonProps {
  appointmentId: string;
  patientName: string;
  status: string;
  canReceive: boolean;
  onArrive: (appointmentId: string) => Promise<void>;
}

export default function AppointmentArrivedButton({
  appointmentId,
  patientName,
  status,
  canReceive,
  onArrive,
}: AppointmentArrivedButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isScheduled = status === "scheduled" || status === "scheduled-physio";
  const isArrived = status === "arrived" || status === "waiting";
  const isCompleted = status === "completed" || status === "cancelled";

  if (!isScheduled || !canReceive || isCompleted) {
    return null;
  }

  if (isArrived) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5">
        <span className="text-sm">✓</span>
        <span className="text-[10px] font-semibold text-emerald-700">Arrived</span>
      </div>
    );
  }

  async function handleArrive() {
    setBusy(true);
    setError(null);
    haptic("tap");
    try {
      await onArrive(appointmentId);
      haptic("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mark arrival";
      setError(message);
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleArrive}
        disabled={busy}
        className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {busy && <Spinner size="xs" className="border-white/30 border-t-white" />}
        {busy ? "Marking…" : "Mark arrived"}
      </button>
      {error && <p className="text-[9px] text-red-600">{error}</p>}
    </div>
  );
}
