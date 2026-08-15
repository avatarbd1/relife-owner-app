"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";

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

type Tab = "today" | "history" | "overview";

const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] duration-100 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400";

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
const FDI_TEETH = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "48", "47", "46", "45", "44", "43", "42", "41",
  "31", "32", "33", "34", "35", "36", "37", "38",
];

function statusTone(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  const value = status.trim().toLowerCase();
  if (value === "completed") return "success";
  if (value === "ongoing" || value === "follow-up") return "info";
  if (value === "planned") return "warning";
  if (value === "cancelled" || value === "rejected") return "error";
  return "neutral";
}

function ProcedureBadge({ value }: { value: string }) {
  const tone = /extract/i.test(value)
    ? "error"
    : /rct|dressing/i.test(value)
      ? "warning"
      : /filling|scaling/i.test(value)
        ? "success"
        : "info";
  return <StatusBadge tone={tone}>{value || "Procedure"}</StatusBadge>;
}

export default function DentalClinicalWorkspaceClient({ workspace, oversight = false }: { workspace: Workspace; oversight?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("today");
  const [procedureChoice, setProcedureChoice] = useState(PROCEDURES[0]);
  const [customProcedure, setCustomProcedure] = useState("");
  const [toothArea, setToothArea] = useState("");
  const [clinicalNote, setClinicalNote] = useState("");
  const [status, setStatus] = useState("Completed");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const canExecute = workspace.canWrite && !oversight;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const completed = useMemo(() => workspace.treatments.filter((item) => item.status.toLowerCase() === "completed").length, [workspace.treatments]);
  const ongoing = useMemo(() => workspace.treatments.filter((item) => ["ongoing", "follow-up", "planned"].includes(item.status.toLowerCase())).length, [workspace.treatments]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!online) {
      setMessage("✕ Internet connection required");
      haptic("error");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const procedure = procedureChoice === "Other" ? customProcedure.trim() : procedureChoice;
      const response = await fetch("/api/clinical/dental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId: workspace.patient.patientId, procedure, toothArea, clinicalNote, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "DENTAL_CLINICAL_FAILED");
      setMessage(`✓ Saved ${String(payload.treatmentId || "Dental record")}`);
      setToothArea("");
      setClinicalNote("");
      setCustomProcedure("");
      setStatus("Completed");
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Save failed"}`);
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "today", label: "Today" },
    { id: "history", label: "History" },
    { id: "overview", label: "Overview" },
  ];

  return (
    <div className="space-y-4">
      {!online && <InlineNotice tone="warning" title="Offline — Dental writes paused">Loaded history দেখা যাবে, কিন্তু procedure save করতে internet লাগবে।</InlineNotice>}
      {oversight && <InlineNotice tone="info" title="Owner oversight mode">Dental clinical data read-only. একই account-এ Dentist role থাকলে execution controls দেখা যাবে।</InlineNotice>}
      {!oversight && !workspace.canWrite && <InlineNotice tone="warning" title="Read-only Dental file">এই patient-এর Dental write permission/assignment এই account-এ নেই।</InlineNotice>}
      {message && <div className={message.startsWith("✓") ? "relife-success-flash" : "relife-error-shake"}><InlineNotice tone={message.startsWith("✓") ? "success" : "error"}>{message}</InlineNotice></div>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Dental clinical</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{workspace.patient.diagnosis || "Dental workspace"}</h2>
            <p className="mt-1 text-xs text-slate-500">{workspace.patient.therapist || "Unassigned dentist"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="success">{completed} completed</StatusBadge>
            {ongoing > 0 && <StatusBadge tone="warning">{ongoing} active</StatusBadge>}
          </div>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-horizontal-scroll>
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Dental clinical tabs">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); haptic("tap"); }} className={`min-h-11 rounded-lg px-4 text-xs font-semibold ${tab === item.id ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "today" && (
        <div className="relife-fade-in">
          {canExecute ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Today&apos;s procedure</h2>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">Tap procedure → tooth → status; type only clinical note</p>
                </div>
                <StatusBadge tone="success">Execution</StatusBadge>
              </div>

              <form onSubmit={submit} className="mt-4 space-y-4">
                <TapChoice
                  label="Procedure *"
                  value={procedureChoice}
                  columns={3}
                  tone="emerald"
                  options={PROCEDURES.map((item) => ({
                    value: item,
                    label: item,
                    tone: /extract/i.test(item) ? "red" as const : /rct|dressing/i.test(item) ? "amber" as const : "emerald" as const,
                  }))}
                  onChange={(value) => value && setProcedureChoice(value)}
                />
                {procedureChoice === "Other" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Procedure name *</label>
                    <input className={inputClass} value={customProcedure} onChange={(event) => setCustomProcedure(event.target.value)} required placeholder="Only type when procedure is not in the buttons" />
                  </div>
                )}

                <fieldset>
                  <legend className="mb-2 text-xs font-semibold text-slate-700">FDI tooth quick select</legend>
                  <div className="grid grid-cols-8 gap-1.5">
                    {FDI_TEETH.map((tooth) => {
                      const active = toothArea === tooth;
                      return (
                        <button key={tooth} type="button" aria-pressed={active} onClick={() => { setToothArea(tooth); haptic("tap"); }} className={`min-h-10 rounded-md border text-xs font-bold ${active ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-emerald-50"}`}>
                          {tooth}
                        </button>
                      );
                    })}
                  </div>
                  <input className={`${inputClass} mt-2`} value={toothArea} onChange={(event) => setToothArea(event.target.value)} placeholder="Only type area if FDI button is not enough" />
                </fieldset>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">Clinical finding / today&apos;s treatment *</label>
                  <textarea className={`${inputClass} min-h-28 resize-y py-3`} value={clinicalNote} onChange={(event) => setClinicalNote(event.target.value)} required placeholder="Complaint, finding, treatment details, material, follow-up…" />
                </div>

                <TapChoice
                  label="Status *"
                  value={status}
                  columns={4}
                  tone="emerald"
                  options={STATUSES.map((item) => ({
                    value: item,
                    label: item,
                    tone: item === "Completed" ? "emerald" as const : item === "Planned" ? "amber" as const : "blue" as const,
                  }))}
                  onChange={(value) => value && setStatus(value)}
                />

                <button type="submit" disabled={busy || !online || !clinicalNote.trim() || (procedureChoice === "Other" && !customProcedure.trim())} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-md hover:bg-emerald-800 disabled:shadow-none">
                  {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving Dental record" />}
                  {busy ? "Saving…" : "Save Dental record"}
                </button>
                <p className="text-center text-[10px] text-slate-400">Immediate audited write · no local draft advertised.</p>
              </form>
            </section>
          ) : <InlineNotice tone="neutral">Execution controls unavailable in this view. Open History or Overview.</InlineNotice>}
        </div>
      )}

      {tab === "history" && (
        <section className="relife-fade-in rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div><h2 className="text-base font-semibold text-slate-950">Dental treatment history</h2><p className="mt-0.5 text-xs text-slate-500">Live 05_Treatments · latest first</p></div>
            <StatusBadge tone="neutral">{workspace.treatments.length}</StatusBadge>
          </div>
          <div className="mt-4 space-y-2">
            {workspace.treatments.map((item) => (
              <details key={item.treatmentId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><ProcedureBadge value={item.procedure} />{item.toothArea && <StatusBadge tone="info">FDI {item.toothArea}</StatusBadge>}</div>
                      <p className="mt-2 text-[11px] text-slate-500">{item.date || "—"}{item.clinician ? ` · ${item.clinician}` : ""}</p>
                    </div>
                    <StatusBadge tone={statusTone(item.status)}>{item.status || "Recorded"}</StatusBadge>
                  </div>
                </summary>
                <div className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-700">
                  <p>{item.clinicalNote || "No clinical note"}</p>
                  {item.remarks && <p className="mt-2 text-slate-500">{item.remarks}</p>}
                  <p className="mt-2 text-[10px] text-slate-400">{item.treatmentId}</p>
                </div>
              </details>
            ))}
            {workspace.treatments.length === 0 && <InlineNotice tone="neutral">Dental treatment history নেই।</InlineNotice>}
          </div>
        </section>
      )}

      {tab === "overview" && (
        <div className="relife-fade-in space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Clinical overview</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Records</p><p className="mt-1 text-lg font-bold text-slate-950">{workspace.treatments.length}</p></div>
              <div className="rounded-lg bg-emerald-50 p-3"><p className="text-[10px] text-emerald-700">Completed</p><p className="mt-1 text-lg font-bold text-emerald-950">{completed}</p></div>
              <div className="rounded-lg bg-amber-50 p-3"><p className="text-[10px] text-amber-700">Active</p><p className="mt-1 text-lg font-bold text-amber-950">{ongoing}</p></div>
            </div>
            {workspace.patient.diagnosis && <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Complaint / diagnosis</p><p className="mt-1 text-sm leading-6 text-slate-800">{workspace.patient.diagnosis}</p></div>}
          </section>
        </div>
      )}
    </div>
  );
}
