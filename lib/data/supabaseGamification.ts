import "server-only";

import {
  RELIFE_SUPABASE_SCOPE,
  type RelifeDepartment,
} from "@/lib/config/relifeSystem";

export type GamificationConfigDepartment = RelifeDepartment | "All";

export interface GamificationConfigSnapshot {
  department: GamificationConfigDepartment;
  configs: Record<string, unknown>;
  versions: Record<string, number>;
}

export interface VerifiedGamificationEventInput {
  requestId: string;
  staffId: string;
  department: RelifeDepartment;
  roleContext: string;
  eventType: string;
  eventKey: string;
  sourceType: string;
  sourceId: string;
  eventAt: string;
  metricValue?: number;
  qualityScore?: number | null;
  xpAwarded?: number;
  reason?: string;
  verifiedBy?: string;
  verificationMethod?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
}

export interface VerifiedGamificationEventResult {
  eventId: string;
  xpAwarded: number;
  duplicate: boolean;
}

const DEFAULT_GAMIFICATION_EDGE_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-gamification-api";

function endpoint(): string {
  return (
    process.env.RELIFE_SUPABASE_GAMIFICATION_EDGE_URL ||
    DEFAULT_GAMIFICATION_EDGE_URL
  ).trim();
}

function gamificationEdgeSecret(): string {
  return (
    process.env.RELIFE_GAMIFICATION_EDGE_SECRET ||
    process.env.RELIFE_EDGE_SECRET ||
    ""
  ).trim();
}

export function gamificationSupabaseConfigured(): boolean {
  return Boolean(endpoint() && gamificationEdgeSecret());
}

async function callGamification<T>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const secret = gamificationEdgeSecret();
  if (!secret) throw new Error("GAMIFICATION_EDGE_SECRET_MISSING");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
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
    if (!response.ok || !result?.ok) {
      const detail = String(result?.detail || result?.error || `HTTP ${response.status}`);
      const error = new Error(detail);
      (error as Error & { status?: number; payload?: unknown }).status = response.status;
      (error as Error & { status?: number; payload?: unknown }).payload = result;
      throw error;
    }
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getGamificationConfig(
  department: GamificationConfigDepartment = "All"
): Promise<GamificationConfigSnapshot> {
  const result = await callGamification<{
    department?: unknown;
    configs?: unknown;
    versions?: unknown;
  }>("config", { department });

  const configs =
    result.configs && typeof result.configs === "object" && !Array.isArray(result.configs)
      ? (result.configs as Record<string, unknown>)
      : {};
  const rawVersions =
    result.versions && typeof result.versions === "object" && !Array.isArray(result.versions)
      ? (result.versions as Record<string, unknown>)
      : {};
  const versions = Object.fromEntries(
    Object.entries(rawVersions).map(([key, value]) => [key, Number(value || 0)])
  );
  const resolvedDepartment = String(result.department || department);

  return {
    department:
      resolvedDepartment === "Physio" || resolvedDepartment === "Dental"
        ? resolvedDepartment
        : "All",
    configs,
    versions,
  };
}

export async function recordVerifiedGamificationEvent(
  input: VerifiedGamificationEventInput
): Promise<VerifiedGamificationEventResult> {
  const result = await callGamification<{
    eventId?: unknown;
    xpAwarded?: unknown;
    duplicate?: unknown;
  }>("record_verified_event", input as unknown as Record<string, unknown>);

  const eventId = String(result.eventId || "").trim();
  if (!eventId) throw new Error("GAMIFICATION_EVENT_ID_MISSING");
  return {
    eventId,
    xpAwarded: Number(result.xpAwarded || 0),
    duplicate: Boolean(result.duplicate),
  };
}
