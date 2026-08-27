"use client";

import type { ChamberSession, ChamberQueueItem } from "@/lib/webos/chamber";

interface PatientInFlow {
  type: "waiting" | "in_treatment" | "completed";
  patientId: string;
  patientName: string;
  gender: string;
  therapist: string;
  currentStep?: string;
  bed?: string;
  startedAt?: string;
  completedAt?: string;
}

interface PatientFlowTimelineProps {
  waiting: ChamberQueueItem[];
  inTreatment: ChamberSession[];
  completed: ChamberSession[];
}

function flowStageIcon(stage: string): string {
  if (stage === "waiting") return "⏳";
  if (stage === "in_treatment") return "🏥";
  if (stage === "completed") return "✓";
  return "•";
}

function stageName(stage: string): string {
  if (stage === "waiting") return "Waiting";
  if (stage === "in_treatment") return "In Treatment";
  if (stage === "completed") return "Completed";
  return "Unknown";
}

function stageBg(stage: string): string {
  if (stage === "waiting") return "bg-amber-50 border-amber-200 text-amber-700";
  if (stage === "in_treatment") return "bg-emerald-50 border-emerald-200 text-emerald-700";
  if (stage === "completed") return "bg-slate-50 border-slate-200 text-slate-600";
  return "bg-slate-50 border-slate-200 text-slate-600";
}

export default function ChamberPatientFlowTimeline({
  waiting,
  inTreatment,
  completed,
}: PatientFlowTimelineProps) {
  const stages = [
    { id: "waiting", label: stageName("waiting"), items: waiting, count: waiting.length },
    { id: "in_treatment", label: stageName("in_treatment"), items: inTreatment, count: inTreatment.length },
    { id: "completed", label: stageName("completed"), items: completed.slice(0, 10), count: completed.length },
  ];

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="px-4 py-3.5">
        <h3 className="text-sm font-semibold text-slate-900">Patient flow today</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">Booked → Arrived → Waiting → Treatment → Corridor/Exercise → Completed</p>
      </div>

      <div className="grid grid-cols-1 gap-px border-t border-slate-100 bg-slate-50 sm:grid-cols-3">
        {stages.map((stage) => (
          <div key={stage.id} className="bg-white p-3 sm:border-r sm:last:border-r-0 sm:border-slate-100">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{flowStageIcon(stage.id)}</span>
                <span className="text-xs font-semibold text-slate-700">{stage.label}</span>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                {stage.count}
              </span>
            </div>

            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {stage.items.length === 0 ? (
                <p className="py-2 text-center text-[10px] text-slate-400">Empty</p>
              ) : (
                stage.items.map((item) => {
                  const session = "sessionId" in item ? (item as ChamberSession) : null;
                  const queue = "appointmentId" in item ? (item as ChamberQueueItem) : null;

                  return (
                    <div
                      key={session?.sessionId || queue?.appointmentId}
                      className={`rounded-lg border p-2 text-[10px] ${stageBg(stage.id)}`}
                    >
                      <p className="font-semibold truncate">
                        {session?.patientName || queue?.patientName}
                      </p>
                      <p className="mt-0.5 text-[9px] opacity-75">
                        {queue ? `• ${queue.therapist || "Unassigned"}` : ""}
                        {session ? `• ${session.therapist || "Unassigned"} • ${session.currentStep || "Setup"}` : ""}
                      </p>
                      {session?.gender && (
                        <p className="mt-1 text-[9px] font-medium">
                          {session.gender === "Male" ? "👨" : "👩"} {session.gender}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
