export interface ChamberTreatmentStepInput {
  step: string;
  resourceId?: string;
  startedAt?: string;
  endedAt?: string;
  plannedDurationMin?: number;
}

export interface ChamberClinicalFields {
  treatmentGiven: string;
  electrotherapy: string;
  manualTherapy: string;
  stepCount: number;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function actualDurationMin(step: ChamberTreatmentStepInput): number {
  const start = Date.parse(clean(step.startedAt));
  const end = Date.parse(clean(step.endedAt));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.max(1, Math.round((end - start) / 60_000));
  }
  const planned = Math.round(Number(step.plannedDurationMin || 0));
  return Number.isFinite(planned) && planned > 0 ? planned : 0;
}

function formatStep(step: ChamberTreatmentStepInput): string {
  const name = clean(step.step);
  const duration = actualDurationMin(step);
  return duration > 0 ? `${name} (${duration} min)` : name;
}

export function buildChamberClinicalFields(
  input: ChamberTreatmentStepInput[]
): ChamberClinicalFields {
  const steps = input.filter((step) => {
    const name = clean(step.step);
    return Boolean(name) && name.toLowerCase() !== "treatment started";
  });

  if (steps.length === 0) {
    return {
      treatmentGiven: "Therapist session",
      electrotherapy: "",
      manualTherapy: "Therapist session",
      stepCount: 0,
    };
  }

  const formatted = steps.map(formatStep);
  const electrotherapy = steps
    .filter((step) => Boolean(clean(step.resourceId)))
    .map(formatStep)
    .join("; ");
  const manualTherapy = steps
    .filter((step) => !clean(step.resourceId))
    .map(formatStep)
    .join("; ");

  return {
    treatmentGiven: formatted
      .map((value, index) => `${index + 1}. ${value}`)
      .join(" → "),
    electrotherapy,
    manualTherapy,
    stepCount: steps.length,
  };
}
