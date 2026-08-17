"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { InlineNotice, ProgressBar, Spinner, StatusBadge } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import { haptic } from "@/lib/interactions";

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

type Tab = "assessment" | "plans" | "today" | "history";

const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] duration-100 focus:border-blue-800 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";
const textareaClass = `${inputClass} min-h-24 resize-y py-3`;

async function post(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "SAVE_FAILED");
  return payload as Record<string, unknown>;
}

function findings(text: string): string {
  try {
    const data = JSON.parse(text) as { Findings?: string };
    return data.Findings || text;
  } catch {
    return text;
  }
}

function painNumber(value: string): number | null {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : null;
}

function painTone(value: string): "success" | "warning" | "error" | "neutral" {
  const score = painNumber(value);
  if (score === null) return "neutral";
  if (score <= 3) return "success";
  if (score <= 7) return "warning";
  return "error";
}

function PainTrendMini({ sessions }: { sessions: Workspace["sessions"] }) {
  const recent = sessions.slice(0, 10).reverse();
  if (recent.length < 2) return null;

  const painBefores = recent.map((s) => painNumber(s.painBefore)).filter((p) => p !== null);
  const painAfters = recent.map((s) => painNumber(s.painAfter)).filter((p) => p !== null);

  if (painBefores.length < 2 && painAfters.length < 2) return null;

  const maxPain = Math.max(...painBefores, ...painAfters, 1);
  const minPain = 0;

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Pain trend (last {recent.length} sessions)</p>
      <div className="mt-2 flex h-16 items-end gap-1">
        {recent.map((session, idx) => {
          const before = painNumber(session.painBefore);
          const after = painNumber(session.painAfter);
          const height = before !== null ? ((before - minPain) / (maxPain - minPain)) * 100 : 0;
          const change = before !== null && after !== null ? before - after : null;

          return (
            <div key={session.treatmentId} className="flex-1 flex flex-col items-center gap-1" title={`S${session.sessionNo}: Before ${before || '–'}, After ${after || '–'}`}>
              {before !== null && (
                <div
                  className={`w-full rounded-t-sm ${painTone(String(before)) === "success" ? "bg-emerald-400" : painTone(String(before)) === "warning" ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ height: `${height}%`, minHeight: height > 0 ? "4px" : "2px" }}
                />
              )}
              {change !== null && (
                <span className="text-[8px] font-bold text-slate-600">{change > 0 ? "↓" : change < 0 ? "↑" : "–"}</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[9px] text-slate-400">Green = improving · Amber = moderate · Red = severe</p>
    </div>
  );
}

function PainScale({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-slate-700">{label}</legend>
      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((item) => {
          const active = value === item;
          const score = Number(item);
          const tone =
            score <= 3
              ? active
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
              : score <= 7
                ? active
                  ? "border-amber-600 bg-amber-600 text-white"
                  : "border-amber-200 bg-amber-50 text-amber-800"
                : active
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-red-200 bg-red-50 text-red-800";
          return (
            <button
              key={item}
              type="button"
              onClick={() => {
                onChange(item);
                haptic("tap");
              }}
              className={`min-h-11 rounded-lg border text-sm font-bold ${tone}`}
              aria-pressed={active}
            >
              {item}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Panel({
  title,
  subtitle,
  children,
  badge,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AssessmentForm({
  patientId,
  onSaved,
  online,
}: {
  patientId: string;
  onSaved: (message: string) => void;
  online: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("general");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) return onSaved("✕ Internet connection required");
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await post("/api/clinical/assessment", {
        patientId,
        category,
        findings: form.get("findings"),
      });
      event.currentTarget.reset();
      setCategory("general");
      onSaved("✓ Assessment saved");
    } catch (error) {
      onSaved(`✕ ${error instanceof Error ? error.message : "Assessment save failed"}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <TapChoice
        label="Assessment category"
        value={category}
        columns={3}
        options={[
          { value: "general", label: "General", tone: "blue" },
          { value: "lbp", label: "Low back pain", tone: "blue" },
          { value: "neck", label: "Neck", tone: "blue" },
          { value: "shoulder", label: "Shoulder", tone: "blue" },
          { value: "knee", label: "Knee", tone: "blue" },
          { value: "hip", label: "Hip", tone: "blue" },
          { value: "ankle", label: "Ankle", tone: "blue" },
          { value: "neuro", label: "Neuro", tone: "amber" },
          { value: "post_op", label: "Post-op", tone: "emerald" },
        ]}
        onChange={(value) => value && setCategory(value)}
      />
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Clinical findings</label>
        <textarea
          name="findings"
          required
          placeholder="Key findings, tests, ROM, neuro, clinical impression…"
          className={textareaClass}
        />
      </div>
      <button
        disabled={busy || !online}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none"
      >
        {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving assessment" />}
        {busy ? "Saving…" : "Save assessment"}
      </button>
    </form>
  );
}

function PlanForm({
  patientId,
  diagnosis,
  onSaved,
  online,
}: {
  patientId: string;
  diagnosis: string;
  onSaved: (message: string) => void;
  online: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState("10");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) return onSaved("✕ Internet connection required");
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
      onSaved(`✕ ${error instanceof Error ? error.message : "Plan save failed"}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Diagnosis</label>
        <input name="diagnosis" defaultValue={diagnosis} placeholder="Diagnosis" className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Planned sessions</label>
        <div className="grid grid-cols-4 gap-2">
          {["7", "14", "21", "28"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setSessions(item);
                haptic("tap");
              }}
              className={`min-h-11 rounded-lg border text-xs font-semibold ${sessions === item ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <input
          name="totalSessions"
          type="number"
          min="1"
          max="365"
          required
          value={sessions}
          onChange={(event) => setSessions(event.target.value)}
          className={`${inputClass} mt-2`}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Exercise plan</label>
        <textarea name="exercisePlan" placeholder="Exercise plan" className={textareaClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Electrotherapy</label>
        <textarea name="electrotherapyPlan" placeholder="TENS, IFT, EMS, US, SWD…" className={textareaClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Manual therapy</label>
        <textarea name="manualTherapyPlan" placeholder="Mobilization, Mulligan, soft tissue…" className={textareaClass} />
      </div>
      <button
        disabled={busy || !online}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none"
      >
        {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving treatment plan" />}
        {busy ? "Saving…" : "Create treatment plan"}
      </button>
    </form>
  );
}

function SessionForm({
  patientId,
  activePlan,
  sessions,
  onSaved,
  online,
}: {
  patientId: string;
  activePlan: Workspace["activePlan"];
  sessions: Workspace["sessions"];
  onSaved: (message: string) => void;
  online: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [painBefore, setPainBefore] = useState("");
  const [painAfter, setPainAfter] = useState("");
  const [response, setResponse] = useState("");
  const [modification, setModification] = useState("");
  const [remarks, setRemarks] = useState("");
  const lastSession = sessions[0];
  const painTrend = lastSession
    ? {
        lastBefore: painNumber(lastSession.painBefore),
        lastAfter: painNumber(lastSession.painAfter),
      }
    : null;

  function copyFromLastSession() {
    if (!lastSession) return;
    haptic("tap");
    setResponse(lastSession.response || "");
    setModification(lastSession.modification || "");
    setRemarks(lastSession.remarks || "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) return onSaved("✕ Internet connection required");
    setBusy(true);
    try {
      const result = await post("/api/clinical/session", {
        patientId,
        painBefore,
        painAfter,
        response,
        modification,
        remarks,
      });
      setPainBefore("");
      setPainAfter("");
      setResponse("");
      setModification("");
      setRemarks("");
      onSaved(`✓ Session ${String(result.sessionNo || "")} saved`);
    } catch (error) {
      onSaved(`✕ ${error instanceof Error ? error.message : "Session save failed"}`);
    } finally {
      setBusy(false);
    }
  }

  if (!activePlan) {
    return (
      <InlineNotice tone="warning" title="Active plan required">
        Treatment session record করার আগে treatment plan তৈরি করুন।
      </InlineNotice>
    );
  }

  const planProgress = activePlan.totalSessions
    ? (activePlan.sessionsDone / activePlan.totalSessions) * 100
    : 0;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-blue-950">Active plan · {activePlan.planId}</p>
            <p className="mt-0.5 text-[11px] text-blue-700">{activePlan.diagnosis || "Physio plan"}</p>
          </div>
          <StatusBadge tone="info">{activePlan.sessionsDone}/{activePlan.totalSessions}</StatusBadge>
        </div>
        <ProgressBar value={planProgress} label="Plan progress" className="mt-3" />
      </div>

      <PainTrendMini sessions={sessions} />

      {lastSession && painTrend && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <p className="text-[11px] font-semibold text-amber-900">Last session · {lastSession.date}</p>
          <div className="mt-2 flex gap-2">
            {painTrend.lastBefore !== null && (
              <div className="flex-1">
                <p className="text-[10px] text-amber-700">Before</p>
                <StatusBadge tone={painTone(String(painTrend.lastBefore))}>{painTrend.lastBefore}/10</StatusBadge>
              </div>
            )}
            {painTrend.lastAfter !== null && (
              <div className="flex-1">
                <p className="text-[10px] text-amber-700">After</p>
                <StatusBadge tone={painTone(String(painTrend.lastAfter))}>{painTrend.lastAfter}/10</StatusBadge>
              </div>
            )}
          </div>
          {lastSession.response && (
            <p className="mt-2 text-[11px] leading-4 text-amber-800"><strong>Response:</strong> {lastSession.response.slice(0, 80)}…</p>
          )}
        </div>
      )}

      <PainScale value={painBefore} onChange={setPainBefore} label="Pain before · 1–10" />
      <PainScale value={painAfter} onChange={setPainAfter} label="Pain after · 1–10" />

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label className="block text-xs font-semibold text-slate-700">Response to treatment</label>
          {lastSession && (
            <button
              type="button"
              onClick={copyFromLastSession}
              className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 underline"
            >
              📋 Copy from last
            </button>
          )}
        </div>
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Response to treatment"
          className={textareaClass}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Modification / progression</label>
        <textarea
          value={modification}
          onChange={(e) => setModification(e.target.value)}
          placeholder="Progression, regression, changes…"
          className={textareaClass}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Daily note</label>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Daily treatment note / remarks"
          className={textareaClass}
        />
      </div>
      <button
        disabled={busy || !online}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 disabled:shadow-none"
      >
        {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving treatment session" />}
        {busy ? "Saving…" : "Complete session"}
      </button>
      <p className="text-center text-[10px] leading-4 text-slate-400">Save writes immediately to the clinical record; no local draft is advertised.</p>
    </form>
  );
}

export default function ClinicalWorkspaceClient({
  workspace,
  oversight = false,
}: {
  workspace: Workspace;
  oversight?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(workspace.activePlan ? "today" : "assessment");
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

  const progress = workspace.activePlan?.totalSessions
    ? (workspace.activePlan.sessionsDone / workspace.activePlan.totalSessions) * 100
    : 0;
  const latestSession = workspace.sessions[0];
  const painChange = useMemo(() => {
    if (!latestSession) return null;
    const before = painNumber(latestSession.painBefore);
    const after = painNumber(latestSession.painAfter);
    if (before === null || after === null) return null;
    return before - after;
  }, [latestSession]);

  function saved(value: string) {
    setMessage(value);
    if (value.startsWith("✓")) {
      haptic("success");
      router.refresh();
    } else {
      haptic("error");
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "assessment", label: "Assessment" },
    { id: "plans", label: "Plans" },
    { id: "today", label: "Today" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="space-y-4">
      {!online && (
        <InlineNotice tone="warning" title="Offline — clinical writes paused">
          Loaded information দেখা যাবে, কিন্তু assessment/plan/session save করতে internet লাগবে।
        </InlineNotice>
      )}
      {oversight && (
        <InlineNotice tone="info" title="Owner oversight mode">
          Clinical data read-only দেখানো হচ্ছে। Clinician role একই account-এ থাকলে execution controls available হবে।
        </InlineNotice>
      )}
      {!oversight && !workspace.canWrite && (
        <InlineNotice tone="warning" title="Read-only clinical file">
          এই patient আপনার assigned/cross-cover scope-এ নেই। History দেখা যাবে, write controls নয়।
        </InlineNotice>
      )}
      {message && (
        <div className={message.startsWith("✓") ? "relife-success-flash" : "relife-error-shake"}>
          <InlineNotice tone={message.startsWith("✓") ? "success" : "error"}>{message}</InlineNotice>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">Physio clinical</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{workspace.patient.diagnosis || "Clinical workspace"}</h2>
            <p className="mt-1 text-xs text-slate-500">{workspace.patient.therapist || "Unassigned therapist"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workspace.activePlan && <StatusBadge tone="info">Active plan</StatusBadge>}
            {painChange !== null && (
              <StatusBadge tone={painChange > 0 ? "success" : painChange < 0 ? "error" : "neutral"}>
                {painChange > 0 ? `↓ Pain ${painChange}` : painChange < 0 ? `↑ Pain ${Math.abs(painChange)}` : "Pain unchanged"}
              </StatusBadge>
            )}
          </div>
        </div>

        {workspace.activePlan ? (
          <div className="mt-4">
            <ProgressBar value={progress} label={`${workspace.activePlan.sessionsDone}/${workspace.activePlan.totalSessions} sessions completed`} />
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">No active treatment plan.</p>
        )}
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-horizontal-scroll>
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Clinical workspace tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id);
                haptic("tap");
              }}
              className={`min-h-11 rounded-lg px-4 text-xs font-semibold ${tab === item.id ? "bg-blue-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "assessment" && (
        <div className="space-y-4 relife-fade-in">
          {canExecute && (
            <Panel title="Quick assessment" subtitle="Tap category, type only patient-specific findings" badge={<StatusBadge tone="info">Live write</StatusBadge>}>
              <AssessmentForm patientId={workspace.patient.patientId} onSaved={saved} online={online} />
            </Panel>
          )}
          <Panel title="Assessment history" subtitle="Latest first" badge={<StatusBadge tone="neutral">{workspace.assessments.length}</StatusBadge>}>
            <div className="space-y-2">
              {workspace.assessments.slice(0, 30).map((assessment) => (
                <article key={assessment.assessmentId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge tone="info">{assessment.category || "general"}</StatusBadge>
                    <span className="text-[10px] text-slate-400">{assessment.createdAt}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-800">{findings(assessment.testData)}</p>
                  <p className="mt-2 text-[10px] text-slate-400">{assessment.createdBy} · {assessment.assessmentId}</p>
                </article>
              ))}
              {workspace.assessments.length === 0 && <InlineNotice tone="neutral">Assessment নেই।</InlineNotice>}
            </div>
          </Panel>
        </div>
      )}

      {tab === "plans" && (
        <div className="space-y-4 relife-fade-in">
          {workspace.activePlan && (
            <Panel title="Active treatment plan" subtitle={workspace.activePlan.planId} badge={<StatusBadge tone="success">Active</StatusBadge>}>
              <div className="space-y-3">
                <ProgressBar value={progress} label={`${workspace.activePlan.sessionsDone}/${workspace.activePlan.totalSessions} sessions`} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <PlanItem title="Exercise" value={workspace.activePlan.exercisePlan} />
                  <PlanItem title="Electro" value={workspace.activePlan.electrotherapyPlan} />
                  <PlanItem title="Manual" value={workspace.activePlan.manualTherapyPlan} />
                </div>
              </div>
            </Panel>
          )}
          {canExecute && (
            <Panel title="Create / replace plan" subtitle="Quick packages 7 / 14 / 21 / 28 sessions">
              <PlanForm patientId={workspace.patient.patientId} diagnosis={workspace.patient.diagnosis} onSaved={saved} online={online} />
            </Panel>
          )}
          <Panel title="Plan history" subtitle="Previous and active plans" badge={<StatusBadge tone="neutral">{workspace.plans.length}</StatusBadge>}>
            <div className="space-y-2">
              {workspace.plans.map((plan) => {
                const value = plan.totalSessions ? (plan.sessionsDone / plan.totalSessions) * 100 : 0;
                return (
                  <article key={plan.planId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-sm font-semibold text-slate-900">{plan.diagnosis || "Physio plan"}</p><p className="mt-0.5 text-[11px] text-slate-500">{plan.planId} · {plan.createdDate} · {plan.createdBy}</p></div>
                      <StatusBadge tone={plan.status.toLowerCase() === "active" ? "success" : "neutral"}>{plan.status}</StatusBadge>
                    </div>
                    <ProgressBar value={value} label={`${plan.sessionsDone}/${plan.totalSessions} sessions`} className="mt-3" />
                  </article>
                );
              })}
              {workspace.plans.length === 0 && <InlineNotice tone="neutral">Treatment plan নেই।</InlineNotice>}
            </div>
          </Panel>
        </div>
      )}

      {tab === "today" && (
        <div className="space-y-4 relife-fade-in">
          <Panel title="Today treatment / daily note" subtitle="Pain before/after, response and progression" badge={canExecute ? <StatusBadge tone="success">Execution</StatusBadge> : <StatusBadge tone="neutral">Read only</StatusBadge>}>
            {canExecute ? (
              <SessionForm
                patientId={workspace.patient.patientId}
                activePlan={workspace.activePlan}
                sessions={workspace.sessions}
                onSaved={saved}
                online={online}
              />
            ) : latestSession ? (
              <SessionSummary session={latestSession} />
            ) : (
              <InlineNotice tone="neutral">আজকের জন্য recorded treatment session নেই।</InlineNotice>
            )}
          </Panel>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4 relife-fade-in">
          <Panel title="Treatment history" subtitle="Live 05_Treatments · latest first" badge={<StatusBadge tone="neutral">{workspace.sessions.length}</StatusBadge>}>
            <div className="space-y-2">
              {workspace.sessions.slice(0, 60).map((session) => <SessionSummary key={session.treatmentId} session={session} />)}
              {workspace.sessions.length === 0 && <InlineNotice tone="neutral">Treatment session নেই।</InlineNotice>}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function PlanItem({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-700">{value || "Not specified"}</p>
    </div>
  );
}

function SessionSummary({ session }: { session: Workspace["sessions"][number] }) {
  const before = painNumber(session.painBefore);
  const after = painNumber(session.painAfter);
  const change = before !== null && after !== null ? before - after : null;
  return (
    <article className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Session {session.sessionNo} · {session.date}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{session.therapist} · {session.planId}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {session.painBefore && <StatusBadge tone={painTone(session.painBefore)}>Before {session.painBefore}</StatusBadge>}
          {session.painAfter && <StatusBadge tone={painTone(session.painAfter)}>After {session.painAfter}</StatusBadge>}
        </div>
      </div>
      {change !== null && (
        <div className="mt-2">
          <StatusBadge tone={change > 0 ? "success" : change < 0 ? "error" : "neutral"}>
            {change > 0 ? `Improved ↓${change}` : change < 0 ? `Worse ↑${Math.abs(change)}` : "No pain change"}
          </StatusBadge>
        </div>
      )}
      {session.response && <p className="mt-2 text-xs leading-5 text-slate-700"><strong>Response:</strong> {session.response}</p>}
      {session.modification && <p className="mt-1 text-xs leading-5 text-slate-600"><strong>Modification:</strong> {session.modification}</p>}
      {session.remarks && <p className="mt-1 text-xs leading-5 text-slate-600">{session.remarks}</p>}
      <p className="mt-2 text-[10px] text-slate-400">{session.treatmentId}</p>
    </article>
  );
}
