export const ANIMATION_TIMING = {
  press: 50,
  fast: 100,
  normal: 150,
  page: 180,
  slow: 200,
  spin: 1000,
  pulse: 2000,
} as const;

export const EASING = {
  in: "ease-in",
  out: "ease-out",
  inOut: "ease-in-out",
  enter: "cubic-bezier(0.22, 1, 0.36, 1)",
  exit: "ease-out",
} as const;

export type HapticKind = "tap" | "success" | "error";

function reducedMotionRequested(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function haptic(kind: HapticKind = "tap"): void {
  if (
    typeof navigator === "undefined" ||
    !("vibrate" in navigator) ||
    reducedMotionRequested()
  ) {
    return;
  }

  const pattern: number | number[] =
    kind === "success" ? 20 : kind === "error" ? [30, 40, 30] : 10;

  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration is optional progressive enhancement and must never block an action.
  }
}
