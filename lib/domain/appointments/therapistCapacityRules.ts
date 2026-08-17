export const THERAPIST_MANUAL_MINUTES = 10;

export interface TherapistTimelineStepLike {
  name: string;
  resourceId?: string;
  startMinute: number;
  endMinute: number;
}

export interface TherapistInterval {
  startMinute: number;
  endMinute: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function therapistRequiredStep(step: TherapistTimelineStepLike): boolean {
  const name = normalized(step.name);
  return (
    name === "general session" ||
    name.includes("manual") ||
    name.includes("therapist")
  );
}

export function therapistIntervalsForTimeline(
  steps: TherapistTimelineStepLike[],
  fallback?: TherapistInterval
): TherapistInterval[] {
  if (steps.length === 0) return fallback ? [fallback] : [];

  return steps.flatMap((step) => {
    if (!therapistRequiredStep(step)) return [];
    const startMinute = Number(step.startMinute);
    let endMinute = Number(step.endMinute);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) {
      return [];
    }
    if (normalized(step.name).includes("manual")) {
      endMinute = Math.max(endMinute, startMinute + THERAPIST_MANUAL_MINUTES);
    }
    return [{ startMinute, endMinute }];
  });
}

export function therapistIntervalsOverlap(
  left: TherapistInterval[],
  right: TherapistInterval[]
): TherapistInterval | null {
  for (const a of left) {
    for (const b of right) {
      if (a.startMinute < b.endMinute && a.endMinute > b.startMinute) {
        return {
          startMinute: Math.max(a.startMinute, b.startMinute),
          endMinute: Math.min(a.endMinute, b.endMinute),
        };
      }
    }
  }
  return null;
}
