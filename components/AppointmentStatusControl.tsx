"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES = [
  "Scheduled",
  "Arrived",
  "Waiting",
  "In Treatment",
  "Completed",
  "No-show",
  "Cancelled",
];

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
  const [status, setStatus] = useState(currentStatus || "Scheduled");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (status === currentStatus) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/appointments/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId, department, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "APPOINTMENT_STATUS_FAILED");
      if (navigator.vibrate) navigator.vibrate(18);
      setMessage("✓ Updated");
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Update failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3" onClick={(event) => event.preventDefault()}>
      <select
        aria-label="Appointment status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
      >
        {STATUSES.map((item) => <option key={item}>{item}</option>)}
      </select>
      <button
        type="button"
        disabled={busy || status === currentStatus}
        onClick={save}
        className="min-h-10 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? "…" : "Update"}
      </button>
      {message && <span className={`text-[10px] ${message.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`}>{message}</span>}
    </div>
  );
}
