"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
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

type Clinician = {
  staffId: string;
  fullName: string;
};

const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] duration-100 focus:border-blue-700 focus:ring-2 focus:ring-blue-100";

export default function PatientEditForm({
  patientId,
  initial,
  clinicians = [],
  clinicianLabel = "Clinician",
  clinicianTone = "blue",
  defaultOpen = false,
}: {
  patientId: string;
  initial: PatientEditValues;
  clinicians?: Clinician[];
  clinicianLabel?: string;
  clinicianTone?: "blue" | "emerald";
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ good: boolean; text: string } | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);

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
    <details
      id="patient-edit"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="scroll-mt-24 rounded-xl border border-blue-200 bg-white shadow-sm"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900">
        <span>
          Edit patient profile
          <span className="mt-0.5 block text-[11px] font-normal text-slate-500">Tap fixed choices; type only patient-specific information</span>
        </span>
        <StatusBadge tone="info">Edit</StatusBadge>
      </summary>
      <form onSubmit={submit} className="space-y-4 border-t border-slate-100 p-4">
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

        <TapChoice
          label="Gender"
          value={values.gender}
          allowClear
          options={[
            { value: "Male", label: "Male", tone: "blue" },
            { value: "Female", label: "Female", tone: "emerald" },
          ]}
          onChange={(value) => update("gender", value)}
        />
        <p className="-mt-2 text-[10px] leading-4 text-slate-400">Live Chamber normal treatment beds require Male/Female for room safety.</p>

        <TapChoice
          label="Patient status"
          value={values.status}
          options={[
            { value: "Active", label: "Active", tone: "emerald" },
            { value: "Inactive", label: "Inactive", tone: "slate" },
          ]}
          onChange={(value) => value && update("status", value)}
        />

        <TapChoice
          label={`${clinicianLabel} · tap to assign`}
          value={values.therapist}
          allowClear
          columns={clinicians.length >= 3 ? 3 : 2}
          tone={clinicianTone}
          options={clinicians.map((item) => ({
            value: item.fullName,
            label: item.fullName,
            subtitle: item.staffId,
          }))}
          onChange={(value) => update("therapist", value)}
        />
        {clinicians.length === 0 && (
          <InlineNotice tone="neutral">Active {clinicianLabel.toLowerCase()} option পাওয়া যায়নি; current assignment অপরিবর্তিত রাখা যাবে।</InlineNotice>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
          <input className={inputClass} value={values.address} onChange={(e) => update("address", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Diagnosis / complaint</label>
          <textarea className={`${inputClass} min-h-20`} value={values.diagnosis} onChange={(e) => update("diagnosis", e.target.value)} />
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
