"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500";

export default function PatientEditForm({
  patientId,
  initial,
}: {
  patientId: string;
  initial: PatientEditValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
      setStatus("✓ Patient profile updated");
      router.refresh();
    } catch (error) {
      setStatus(`✕ ${error instanceof Error ? error.message : "Update failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
        Edit patient profile
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
        <button disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Saving..." : "Save changes"}
        </button>
        {status && (
          <p className={`text-xs ${status.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`} role="status">
            {status}
          </p>
        )}
      </form>
    </details>
  );
}
