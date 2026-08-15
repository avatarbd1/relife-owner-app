"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Treatment = {
  treatmentId: string;
  date: string;
  patientId: string;
  patientName: string;
  procedure: string;
  toothArea: string;
  clinicalNote: string;
  status: string;
  clinician: string;
  remarks: string;
};

type Workspace = {
  patient: {
    patientId: string;
    fullName: string;
    department: "Dental";
    diagnosis: string;
    therapist: string;
  };
  canWrite: boolean;
  treatments: Treatment[];
};

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500";

const PROCEDURES = [
  "Consultation",
  "X-ray",
  "Scaling",
  "Filling",
  "Temporary Filling",
  "RCT Opening",
  "RCT",
  "Extraction",
  "Dressing",
  "Crown / Bridge",
  "Denture",
  "Other",
];

const STATUSES = ["Planned", "Ongoing", "Completed", "Follow-up"];

export default function DentalClinicalWorkspaceClient({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [procedureChoice, setProcedureChoice] = useState(PROCEDURES[0]);
  const [customProcedure, setCustomProcedure] = useState("");
  const [toothArea, setToothArea] = useState("");
  const [clinicalNote, setClinicalNote] = useState("");
  const [status, setStatus] = useState("Completed");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const procedure = procedureChoice === "Other" ? customProcedure.trim() : procedureChoice;
      const response = await fetch("/api/clinical/dental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: workspace.patient.patientId,
          procedure,
          toothArea,
          clinicalNote,
          status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "DENTAL_CLINICAL_FAILED");
      }
      if (navigator.vibrate) navigator.vibrate(18);
      setMessage(`✓ Saved ${String(payload.treatmentId || "Dental record")}`);
      setToothArea("");
      setClinicalNote("");
      setCustomProcedure("");
      setStatus("Completed");
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Save failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-300">Dental clinical</p>
        <h2 className="mt-1 text-lg font-semibold">{workspace.patient.fullName}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-300">
          {workspace.patient.patientId} · {workspace.patient.therapist || "Unassigned dentist"}
        </p>
        {workspace.patient.diagnosis && (
          <p className="mt-3 rounded-xl bg-white/10 p-3 text-xs leading-5 text-slate-200">
            Complaint / diagnosis: {workspace.patient.diagnosis}
          </p>
        )}
      </section>

      {workspace.canWrite && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">🦷 আজকের Dental procedure</h2>
            <p className="mt-1 text-xs text-slate-500">
              Telegram Dental flow parity: Procedure → Tooth/Area → Clinical note → Status → Save
            </p>
          </div>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Procedure *</label>
              <select className={inputClass} value={procedureChoice} onChange={(event) => setProcedureChoice(event.target.value)}>
                {PROCEDURES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            {procedureChoice === "Other" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Procedure name *</label>
                <input className={inputClass} value={customProcedure} onChange={(event) => setCustomProcedure(event.target.value)} required placeholder="যেমন: Pulpotomy" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Tooth number / area</label>
              <input className={inputClass} value={toothArea} onChange={(event) => setToothArea(event.target.value)} placeholder="16, 36, Upper anterior..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Clinical finding / আজ কী করা হয়েছে *</label>
              <textarea className={`${inputClass} min-h-28 resize-y`} value={clinicalNote} onChange={(event) => setClinicalNote(event.target.value)} required placeholder="Complaint, finding, treatment note..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Status *</label>
              <select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUSES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={busy || !clinicalNote.trim() || (procedureChoice === "Other" && !customProcedure.trim())}
              className="min-h-12 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-45"
            >
              {busy ? "Saving…" : "Save Dental record"}
            </button>
            {message && (
              <p className={`text-xs ${message.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`} role="status">
                {message}
              </p>
            )}
          </form>
        </section>
      )}

      {!workspace.canWrite && (
        <section className="rounded-2xl bg-amber-50 p-4 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">
          Clinical history দেখা যাবে, কিন্তু এই patient-এর Dental write permission/assignment এই account-এ নেই।
        </section>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">📜 Dental treatment history</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Live 05_Treatments · latest first</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{workspace.treatments.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {workspace.treatments.map((item) => (
            <details key={item.treatmentId} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.procedure}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {item.date || "—"}{item.toothArea ? ` · ${item.toothArea}` : ""}{item.clinician ? ` · ${item.clinician}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                    {item.status || "Recorded"}
                  </span>
                </div>
              </summary>
              <div className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-700">
                <p>{item.clinicalNote || "No clinical note"}</p>
                <p className="mt-2 text-[10px] text-slate-400">{item.treatmentId}</p>
              </div>
            </details>
          ))}
          {workspace.treatments.length === 0 && (
            <p className="py-7 text-center text-sm text-slate-400">Dental treatment history নেই।</p>
          )}
        </div>
      </section>
    </div>
  );
}
