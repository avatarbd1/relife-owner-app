import "server-only";

import { RELIFE_SUPABASE_SCOPE } from "@/lib/config/relifeSystem";

export interface WeeklyPerformanceFinalizedRow {
  id: string;
  staffId: string;
  department: string;
  roleContext: string;
  normalizedScore: number | null;
  provisionalScore: number | null;
  scoreCoveredWeight: number;
  missingScoreMetrics: string[];
  rank: number | null;
  rewardCreditsEarned: number;
  eligibilityReason: string;
  scoreConfigVersion: number | null;
  earningConfigVersion: number | null;
  scoreComponents: Record<string, unknown>;
  sourceCutoffAt: string | null;
}

export interface WeeklyGamificationFinalization {
  finalizationId: string;
  weekStart: string;
  weekEnd: string;
  finalizationKey: string;
  sourceCutoffAt: string | null;
  status: string;
  triggerSource: string;
  requestedBy: string;
  resultSummary: Record<string, unknown>;
  createdAt: string | null;
  finalizedAt: string | null;
  performance: WeeklyPerformanceFinalizedRow[];
}

export interface WeeklyGamificationFinalizeResult {
  alreadyFinalized: boolean;
  finalizationId: string;
  weekStart: string;
  weekEnd: string;
  resultSummary: Record<string, unknown>;
}

export interface MonthlyRosterOpportunitySnapshot {
  staffId: string;
  publishedScheduledMinutes: number;
  publishedShiftCount: number;
}

export interface MonthlyGamificationFinalizeResult {
  alreadyFinalized: boolean;
  finalizationId: string;
  month: string;
  resultSummary: Record<string, unknown>;
}

export interface MonthlyGamificationFinalization {
  finalizationId: string;
  month: string;
  status: string;
  requestedBy: string;
  rosterSnapshot: unknown[];
  configSnapshot: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  createdAt: string | null;
  finalizedAt: string | null;
}

const DEFAULT_WEEKLY_FINALIZER_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-weekly-gamification-finalizer";

function endpoint(): string {
  return (
    process.env.RELIFE_SUPABASE_WEEKLY_GAMIFICATION_URL ||
    DEFAULT_WEEKLY_FINALIZER_URL
  ).trim();
}

function edgeSecret(): string {
  return (
    process.env.RELIFE_GAMIFICATION_EDGE_SECRET ||
    process.env.RELIFE_EDGE_SECRET ||
    ""
  ).trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

async function callWeekly<T>(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 8_000
): Promise<T> {
  const secret = edgeSecret();
  if (!secret) throw new Error("GAMIFICATION_EDGE_SECRET_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-server-key": secret,
      },
      body: JSON.stringify({
        action,
        organizationSlug: RELIFE_SUPABASE_SCOPE.organizationSlug,
        clinicSlug: RELIFE_SUPABASE_SCOPE.clinicSlug,
        ...payload,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) {
      const detail = String(result?.detail || result?.error || `HTTP ${response.status}`);
      const error = new Error(detail);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}

function parseFinalization(value: unknown): WeeklyGamificationFinalization | null {
  const row = objectValue(value);
  const finalizationId = String(row.finalizationId || "").trim();
  if (!finalizationId) return null;
  const performance = Array.isArray(row.performance)
    ? row.performance.flatMap((raw) => {
        const item = objectValue(raw);
        const id = String(item.id || "").trim();
        const staffId = String(item.staffId || "").trim();
        if (!id || !staffId) return [];
        return [{
          id,
          staffId,
          department: String(item.department || "").trim(),
          roleContext: String(item.roleContext || "").trim(),
          normalizedScore: nullableNumber(item.normalizedScore),
          provisionalScore: nullableNumber(item.provisionalScore),
          scoreCoveredWeight: Number(item.scoreCoveredWeight || 0),
          missingScoreMetrics: Array.isArray(item.missingScoreMetrics)
            ? item.missingScoreMetrics.map((entry) => String(entry || "").trim()).filter(Boolean)
            : [],
          rank: nullableNumber(item.rank),
          rewardCreditsEarned: Number(item.rewardCreditsEarned || 0),
          eligibilityReason: String(item.eligibilityReason || "").trim(),
          scoreConfigVersion: nullableNumber(item.scoreConfigVersion),
          earningConfigVersion: nullableNumber(item.earningConfigVersion),
          scoreComponents: objectValue(item.scoreComponents),
          sourceCutoffAt: nullableString(item.sourceCutoffAt),
        } satisfies WeeklyPerformanceFinalizedRow];
      })
    : [];
  return {
    finalizationId,
    weekStart: String(row.weekStart || "").trim(),
    weekEnd: String(row.weekEnd || "").trim(),
    finalizationKey: String(row.finalizationKey || "").trim(),
    sourceCutoffAt: nullableString(row.sourceCutoffAt),
    status: String(row.status || "").trim(),
    triggerSource: String(row.triggerSource || "").trim(),
    requestedBy: String(row.requestedBy || "").trim(),
    resultSummary: objectValue(row.resultSummary),
    createdAt: nullableString(row.createdAt),
    finalizedAt: nullableString(row.finalizedAt),
    performance,
  };
}

export async function getWeeklyGamificationFinalization(
  weekStart?: string
): Promise<WeeklyGamificationFinalization | null> {
  const result = await callWeekly<Record<string, unknown>>(
    "status",
    weekStart ? { weekStart } : {},
    5_000
  );
  return parseFinalization(result.finalization);
}

export async function finalizeWeeklyGamification(input: {
  actorId: string;
  actorRoles: string[];
  weekStart?: string;
}): Promise<WeeklyGamificationFinalizeResult> {
  const action = input.weekStart ? "finalize_week" : "finalize_previous_week";
  const result = await callWeekly<Record<string, unknown>>(action, {
    trigger: "owner_manual",
    actorId: input.actorId,
    actorRoles: input.actorRoles,
    ...(input.weekStart ? { weekStart: input.weekStart } : {}),
  });
  const finalizationId = String(result.finalizationId || "").trim();
  const weekStart = String(result.weekStart || "").trim();
  const weekEnd = String(result.weekEnd || "").trim();
  if (!finalizationId || !weekStart || !weekEnd) {
    throw new Error("WEEKLY_FINALIZATION_RESPONSE_INVALID");
  }
  return {
    alreadyFinalized: result.alreadyFinalized === true,
    finalizationId,
    weekStart,
    weekEnd,
    resultSummary: objectValue(result.resultSummary),
  };
}

export async function getMonthlyGamificationFinalization(
  month?: string
): Promise<MonthlyGamificationFinalization | null> {
  const result = await callWeekly<Record<string, unknown>>(
    "monthly_status",
    month ? { month } : {},
    5_000
  );
  const finalization = objectValue(result.finalization);
  const finalizationId = String(finalization.finalizationId || "").trim();
  if (!finalizationId) return null;
  return {
    finalizationId,
    month: String(finalization.month || "").trim(),
    status: String(finalization.status || "").trim(),
    requestedBy: String(finalization.requestedBy || "").trim(),
    rosterSnapshot: Array.isArray(finalization.rosterSnapshot) ? finalization.rosterSnapshot : [],
    configSnapshot: objectValue(finalization.configSnapshot),
    resultSummary: objectValue(finalization.resultSummary),
    createdAt: nullableString(finalization.createdAt),
    finalizedAt: nullableString(finalization.finalizedAt),
  };
}

export async function finalizeMonthlyGamification(input: {
  actorId: string;
  actorRoles: string[];
  month: string;
  rosterSnapshot: MonthlyRosterOpportunitySnapshot[];
}): Promise<MonthlyGamificationFinalizeResult> {
  const result = await callWeekly<Record<string, unknown>>("finalize_month", input, 10_000);
  const finalizationId = String(result.finalizationId || "").trim();
  const month = String(result.month || "").trim();
  if (!finalizationId || !month) throw new Error("MONTHLY_FINALIZATION_RESPONSE_INVALID");
  return {
    alreadyFinalized: result.alreadyFinalized === true,
    finalizationId,
    month,
    resultSummary: objectValue(result.resultSummary),
  };
}
