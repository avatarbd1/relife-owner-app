"use client";

import { useState } from "react";
import { haptic } from "@/lib/interactions";
import TapChoice from "@/components/TapChoice";

interface StepWorkflowProps {
  sessionId: string;
  currentStep: string;
  stationId: string;
  expectedReleaseAt: string;
  onPost: (key: string, body: Record<string, unknown>) => Promise<void>;
  busyKey: string;
}

const WORKFLOW_STEPS = [
  { id: "Corridor", label: "Corridor", subtitle: "Movement/exercise area", tone: "blue" as const, durationMin: 10 },
  { id: "Exercise", label: "Exercise", subtitle: "Active therapy phase", tone: "emerald" as const, durationMin: 15 },
  { id: "Assessment", label: "Assessment", subtitle: "Post-treatment evaluation", tone: "slate" as const, durationMin: 5 },
  { id: "Complete", label: "Complete", subtitle: "Finish treatment", tone: "amber" as const, durationMin: 0 },
];

export default function ChamberStepWorkflow({
  sessionId,
  currentStep,
  stationId,
  expectedReleaseAt: _expectedReleaseAt,
  onPost,
  busyKey,
}: StepWorkflowProps) {
  const [showDuration, setShowDuration] = useState(false);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [duration, setDuration] = useState("15");

  const nextSteps = WORKFLOW_STEPS.filter((step) => {
    const current = currentStep.toLowerCase().trim();
    const stepId = step.id.toLowerCase();
    if (current === "treatment started") return true;
    if (stepId === "complete") return true;
    if (current === stepId) return false;
    const currentIndex = WORKFLOW_STEPS.findIndex((item) => item.id.toLowerCase() === current);
    const stepIndex = WORKFLOW_STEPS.findIndex((item) => item.id.toLowerCase() === stepId);
    return stepIndex > currentIndex;
  });

  async function handleStepTransition(step: string, dur: number) {
    setShowDuration(false);
    setSelectedStep(null);
    haptic("tap");
    try {
      await onPost(`step:${sessionId}:${step}`, {
        action: "update_step",
        sessionId,
        step,
        durationMin: dur,
        stationId,
      });
    } catch {
      // Error handled by parent.
    }
  }

  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Step workflow</p>
        {busyKey.startsWith(`step:${sessionId}:`) && <span className="text-[10px] font-medium text-blue-700">Updating…</span>}
      </div>

      {showDuration && selectedStep ? (
        <div className="space-y-2">
          <div className="rounded-lg bg-white p-2">
            <label className="text-[10px] font-semibold text-slate-700">Duration (minutes)</label>
            <input
              type="number"
              min="0"
              max="180"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleStepTransition(selectedStep, Number(duration))}
              className="flex-1 rounded bg-emerald-600 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
            >
              ✓ Confirm
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDuration(false);
                setSelectedStep(null);
              }}
              className="flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <TapChoice
          value={currentStep}
          options={nextSteps.map((step) => ({
            value: step.id,
            label: step.label,
            subtitle: step.subtitle,
            tone: step.tone,
          }))}
          columns={nextSteps.length <= 2 ? 2 : nextSteps.length === 3 ? 3 : 4}
          compact
          onChange={(step) => {
            if (!step) return;
            const stepDef = WORKFLOW_STEPS.find((item) => item.id === step);
            if (step === "Complete") {
              void handleStepTransition(step, 0);
            } else {
              setSelectedStep(step);
              setDuration(String(stepDef?.durationMin || 15));
              setShowDuration(true);
            }
          }}
        />
      )}

      <p className="mt-2 text-[9px] leading-3 text-slate-400">Tap step to move patient. Duration estimate helps track expected release time.</p>
    </div>
  );
}
