"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Workspace = {
  patient: {
    patientId: string;
    fullName: string;
    department: string;
    diagnosis: string;
    therapist: string;
  };
  canWrite: boolean;
  assessments: Array<{
    assessmentId: string;
    category: string;
    testData: string;
    createdBy: string;
    createdAt: string;
  }>;
  plans: Array<{
    planId: string;
    diagnosis: string;
    totalSessions: number;
    sessionsDone: number;
    exercisePlan: string;
    electrotherapyPlan: string;
    manualTherapyPlan: string;
    createdBy: string;
    createdDate: string;
    status: string;
  }>;
  activePlan: {
    planId: string;
    diagnosis: string;
    totalSessions: number;
    sessionsDone: number;
    exercisePlan: string;
    electrotherapyPlan: string;
    manualTherapyPlan: string;
    status: string;
  } | null;
  sessions: Array<{
    treatmentId: string;
    date: string;
    sessionNo: number;
    therapist: string;
    planId: string;
    painBefore: string;
    painAfter: string;
    response: string;
    modification: string;
    remarks: string;
  }>;
};

const inputClass = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500";
const textareaClass = `${inputClass} min-h-24 resize-y`;

async function post(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "SAVE_FAILED");
  return payload;
}

function AssessmentForm({ patientId, onSaved }: { patientId: string; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await post("/api/clinical/assessment", {
        patientId,
        category: form.get("category"),
        findings: form.get("findings"),
      });
      event.currentTarget.reset();
      onSaved("✓ Assessment saved");
    } catch (error) {
      onSaved(error instanceof Error ? error.message : "Assessment save failed");
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <select name="category" defaultValue="general" className={inputClass}>
        <option value="general">General</option><option value="lbp">Low back pain</option><option value="neck">Neck</option><option value="shoulder">Shoulder</option><option value="knee">Knee</option><option value="hip">Hip</option><option value="ankle">Ankle</option><option value="neuro">Neuro</option><option value="post_op">Post-op</option>
      </select>
      <textarea name="findings" required placeholder="Key findings, tests, ROM, neuro, clinical impression…" className={textareaClass} />
      <button disabled={busy} className="min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-50">{busy ? "Saving…" : "Save quick assessment"}</button>
    </form>
  );
}

function PlanForm({ patientId, diagnosis, onSaved }: { patientId: string; diagnosis: string; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await post("/api/clinical/plan", {
        patientId,
        diagnosis: form.get("diagnosis"),
        totalSessions: Number(form.get("totalSessions")),
        exercisePlan: form.get("exercisePlan"),
        electrotherapyPlan: form.get("electrotherapyPlan"),
        manualTherapyPlan: form.get("manualTherapyPlan"),
      });
      onSaved("✓ Treatment plan saved");
    } catch (error) {
      onSaved(error instanceof Error ? error.message : "Plan save failed");
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <input name="diagnosis" defaultValue={diagnosis} placeholder="Diagnosis" className={inputClass} />
      <input name="totalSessions" type="number" min="1" max="365" required defaultValue="10" placeholder="Total sessions" className={inputClass} />
      <textarea name="exercisePlan" placeholder="Exercise plan" className={textareaClass} />
      <textarea name="electrotherapyPlan" placeholder="Electrotherapy plan" className={textareaClass} />
      <textarea name="manualTherapyPlan" placeholder="Manual therapy plan" className={textareaClass} />
      <button disabled={busy} className="min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-50">{busy ? "Saving…" : "Create / replace active plan"}</button>
    </form>
  );
}

function SessionForm({ patientId, activePlan, onSaved }: { patientId: string; activePlan: Workspace["activePlan"]; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await post("/api/clinical/session", {
        patientId,
        painBefore: form.get("painBefore"),
        painAfter: form.get("painAfter"),
        response: form.get("response"),
        modification: form.get("modification"),
        remarks: form.get("remarks"),
      });
      event.currentTarget.reset();
      onSaved(`✓ Session ${result.sessionNo} saved`);
    } catch (error) {
      onSaved(error instanceof Error ? error.message : "Session save failed");
    } finally { setBusy(false); }
  }
  if (!activePlan) return <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700">Treatment session দিতে আগে active plan তৈরি করুন।</p>;
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-semibold text-slate-800">Active plan · {activePlan.planId}</p>
        <p className="mt-1">{activePlan.sessionsDone}/{activePlan.totalSessions} sessions recorded</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input name="painBefore" placeholder="Pain before" className={inputClass} />
        <input name="painAfter" placeholder="Pain after" className={inputClass} />
      </div>
      <textarea name="response" placeholder="Response to treatment" className={textareaClass} />
      <textarea name="modification" placeholder="Modification / progression" className={textareaClass} />
      <textarea name="remarks" placeholder="Daily note / remarks" className={textareaClass} />
      <button disabled={busy} className="min-h-12 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-50">{busy ? "Saving…" : "Save treatment session"}</button>
    </form>
  );
}

function findings(text: string): string {
  try {
    const data = JSON.parse(text) as { Findings?: string };
    return data.Findings || text;
  } catch { return text; }
}

export default function ClinicalWorkspaceClient({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  function saved(value: string) {
    setMessage(value);
    if (value.startsWith("✓")) {
      if (navigator.vibrate) navigator.vibrate(18);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {message && <p role="status" className={`rounded-xl p-3 text-xs ${message.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message}</p>}

      {workspace.activePlan && (
        <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Active treatment plan</p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div><h2 className="font-semibold">{workspace.activePlan.diagnosis || "Physio plan"}</h2><p className="mt-1 text-xs text-slate-300">{workspace.activePlan.planId}</p></div>
            <span className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold">{workspace.activePlan.sessionsDone}/{workspace.activePlan.totalSessions}</span>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            {workspace.activePlan.exercisePlan && <p>Exercise · {workspace.activePlan.exercisePlan}</p>}
            {workspace.activePlan.electrotherapyPlan && <p>Electro · {workspace.activePlan.electrotherapyPlan}</p>}
            {workspace.activePlan.manualTherapyPlan && <p>Manual · {workspace.activePlan.manualTherapyPlan}</p>}
          </div>
        </section>
      )}

      {workspace.canWrite && (
        <>
          <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" open={!workspace.activePlan}>
            <summary className="min-h-12 cursor-pointer select-none py-3 text-sm font-semibold text-slate-900">+ Assessment</summary>
            <div className="pt-3"><AssessmentForm patientId={workspace.patient.patientId} onSaved={saved} /></div>
          </details>
          <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <summary className="min-h-12 cursor-pointer select-none py-3 text-sm font-semibold text-slate-900">+ Treatment plan</summary>
            <div className="pt-3"><PlanForm patientId={workspace.patient.patientId} diagnosis={workspace.patient.diagnosis} onSaved={saved} /></div>
          </details>
          <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" open={Boolean(workspace.activePlan)}>
            <summary className="min-h-12 cursor-pointer select-none py-3 text-sm font-semibold text-slate-900">+ Today treatment / daily note</summary>
            <div className="pt-3"><SessionForm patientId={workspace.patient.patientId} activePlan={workspace.activePlan} onSaved={saved} /></div>
          </details>
        </>
      )}

      {!workspace.canWrite && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">Clinical file read-only. Write access শুধু assigned clinician / today cross-cover / Owner-এর জন্য।</p>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-end justify-between"><div><h2 className="text-sm font-semibold text-slate-900">Treatment history</h2><p className="text-[11px] text-slate-500">05_Treatments</p></div><span className="text-xs text-slate-500">{workspace.sessions.length}</span></div>
        <div className="mt-3 space-y-2">
          {workspace.sessions.slice(0, 40).map((session) => (
            <div key={session.treatmentId} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Session {session.sessionNo} · {session.date}</p><p className="mt-0.5 text-[11px] text-slate-500">{session.therapist} · {session.planId}</p></div><span className="text-xs font-medium text-slate-600">{session.painBefore && session.painAfter ? `${session.painBefore} → ${session.painAfter}` : session.painAfter || session.painBefore}</span></div>
              {session.response && <p className="mt-2 text-xs leading-5 text-slate-700">Response: {session.response}</p>}
              {session.modification && <p className="mt-1 text-xs leading-5 text-slate-600">Modification: {session.modification}</p>}
              {session.remarks && <p className="mt-1 text-xs leading-5 text-slate-600">{session.remarks}</p>}
            </div>
          ))}
          {workspace.sessions.length === 0 && <p className="py-5 text-center text-sm text-slate-400">Treatment session নেই।</p>}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-end justify-between"><div><h2 className="text-sm font-semibold text-slate-900">Assessment history</h2><p className="text-[11px] text-slate-500">10_Assessments</p></div><span className="text-xs text-slate-500">{workspace.assessments.length}</span></div>
        <div className="mt-3 space-y-2">
          {workspace.assessments.slice(0, 30).map((assessment) => (
            <div key={assessment.assessmentId} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{assessment.category} · {assessment.createdAt}</p><p className="mt-1 text-sm leading-6 text-slate-800">{findings(assessment.testData)}</p></div>
          ))}
          {workspace.assessments.length === 0 && <p className="py-5 text-center text-sm text-slate-400">Assessment নেই।</p>}
        </div>
      </section>
    </div>
  );
}
