"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type PatientEditValues = {
  fullName: string;
  phone: string;
  age: string;
  gender: string;
  address: string;
  diagnosis: string;
  therapist: string;
  status: string;
};

const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] duration-100 focus:border-blue-700 focus:ring-2 focus:ring-blue-100";

export default function PatientEditForm({
  patientId,
  initial,
  defaultOpen = false,
}: {
  patientId: string;
  initial: PatientEditValues;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ good: boolean; text: string } | null>(null);

  const update = (key: keyof PatientEditValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : `HTTP_${response.status}`);
      }
      const synced = payload?.chamberSynced !== false;
      setStatus({
        good: synced,
        text: synced
          ? "Patient profile updated."
          : "Patient profile updated, but an active Chamber session could not be synchronized. Refresh Chamber before continuing treatment.",
      });
      haptic(synced ? "success" : "error");
      router.refresh();
    } catch (error) {
      setStatus({ good: false, text: error instanceof Error ? error.message : "Update failed" });
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details id="patient-edit" open={defaultOpen} className="scroll-mt-24 rounded-xl border border-blue-200 bg-white shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900">
        <span>
          Edit patient profile
          <span className="mt-0.5 block text-[11px] font-normal text-slate-500">Name, phone, age, gender, diagnosis, clinician and status</span>
        </span>
        <StatusBadge tone="info">Edit</StatusBadge>
      </summary>
      <form onSubmit={submit} className="space-y-3 border-t border-slate-100 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
          <input className={inputClass} value={values.fullName} onChange={(e) => update("fullName", e.target.value)} required minLength={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
            <input className={inputClass} inputMode="tel" value={values.phone} onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Age</label>
            <input className={inputClass} inputMode="numeric" value={values.age} onChange={(e) => update("age", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Gender</label>
            <select className={inputClass} value={values.gender} onChange={(e) => update("gender", e.target.value)}>
              <option value="">Not set</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">Live Chamber bed allocation supports Male/Female room safety. Other/not set will require manual correction before treatment-bed allocation.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
            <select className={inputClass} value={values.status} onChange={(e) => update("status", e.target.value)}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
          <input className={inputClass} value={values.address} onChange={(e) => update("address", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Diagnosis / complaint</label>
          <textarea className={`${inputClass} min-h-20`} value={values.diagnosis} onChange={(e) => update("diagnosis", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Therapist / clinician</label>
          <input className={inputClass} value={values.therapist} onChange={(e) => update("therapist", e.target.value)} />
        </div>
        <button disabled={busy} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-900 disabled:shadow-none">
          {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving patient profile" />}
          {busy ? "Saving…" : "Save patient changes"}
        </button>
        {status && (
          <div className={status.good ? "relife-success-flash" : "relife-error-shake"}>
            <InlineNotice tone={status.good ? "success" : "warning"}>{status.text}</InlineNotice>
          </div>
        )}
      </form>
    </details>
  );
}
