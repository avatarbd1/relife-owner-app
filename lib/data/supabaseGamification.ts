import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RelifeDepartment } from "@/lib/config/relifeSystem";
import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";

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

export interface GamificationEventCount {
  eventType: string;
  roleContext: string;
  count: number;
}

export interface GamificationWeeklyLedgerSnapshot {
  weekStart: string;
  weekEnd: string;
  normalizedScore: number;
  rank: number | null;
  status: string;
  calculationVersion: string;
}

export interface GamificationStaffSummary {
  staffId: string;
  lifetimeXp: number;
  weekXp: number;
  todayXp: number;
  rewardCredits: {
    ledgerBalance: number;
    reservedBalance: number;
    availableBalance: number;
    valid: boolean;
  };
  eventCounts: GamificationEventCount[];
  weeklyPerformance: GamificationWeeklyLedgerSnapshot | null;
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

function adminClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("GAMIFICATION_TENANT_STORE_UNAVAILABLE");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveTenantSlugs(
  scope: TenantScope,
  client = adminClient()
): Promise<{ organizationSlug: string; clinicSlug: string }> {
  const tenant = requireTenantScope(scope);
  const relife = client.schema("relife");
  const [organization, clinic] = await Promise.all([
    relife
      .from("organizations")
      .select("slug,status")
      .eq("id", tenant.organizationId)
      .maybeSingle(),
    relife
      .from("clinics")
      .select("slug,status,organization_id")
      .eq("organization_id", tenant.organizationId)
      .eq("id", tenant.clinicId)
      .maybeSingle(),
  ]);
  if (organization.error || clinic.error) {
    throw new Error("GAMIFICATION_TENANT_RESOLUTION_FAILED");
  }
  const organizationSlug = String(organization.data?.slug || "").trim();
  const clinicSlug = String(clinic.data?.slug || "").trim();
  if (
    !organizationSlug ||
    !clinicSlug ||
    String(organization.data?.status || "").toLowerCase() !== "active" ||
    String(clinic.data?.status || "").toLowerCase() !== "active"
  ) {
    throw new Error("GAMIFICATION_TENANT_NOT_ACTIVE");
  }
  return { organizationSlug, clinicSlug };
}

export function gamificationSupabaseConfigured(): boolean {
  return Boolean(endpoint() && gamificationEdgeSecret());
}

async function callGamification<T>(
  scope: TenantScope,
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 5_000
): Promise<T> {
  const secret = gamificationEdgeSecret();
  if (!secret) throw new Error("GAMIFICATION_EDGE_SECRET_MISSING");
  const tenant = await resolveTenantSlugs(scope);

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
        organizationSlug: tenant.organizationSlug,
        clinicSlug: tenant.clinicSlug,
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
  scope: TenantScope,
  department: GamificationConfigDepartment = "All"
): Promise<GamificationConfigSnapshot> {
  const result = await callGamification<{
    department?: unknown;
    configs?: unknown;
    versions?: unknown;
  }>(scope, "config", { department });

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

export async function getGamificationStaffSummary(
  scope: TenantScope,
  input: {
    staffId: string;
    weekStart: string;
    weekEnd: string;
    today: string;
  }
): Promise<GamificationStaffSummary> {
  const result = await callGamification<Record<string, unknown>>(
    scope,
    "staff_summary",
    input,
    3_000
  );
  const staffId = String(result.staffId || "").trim();
  if (!staffId) throw new Error("GAMIFICATION_STAFF_SUMMARY_INVALID");

  const rewardRaw =
    result.rewardCredits &&
    typeof result.rewardCredits === "object" &&
    !Array.isArray(result.rewardCredits)
      ? (result.rewardCredits as Record<string, unknown>)
      : {};
  const eventCounts = Array.isArray(result.eventCounts)
    ? result.eventCounts.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        return [{
          eventType: String(row.eventType || "").trim(),
          roleContext: String(row.roleContext || "").trim(),
          count: Number(row.count || 0),
        }];
      })
    : [];
  const weeklyRaw =
    result.weeklyPerformance &&
    typeof result.weeklyPerformance === "object" &&
    !Array.isArray(result.weeklyPerformance)
      ? (result.weeklyPerformance as Record<string, unknown>)
      : null;

  return {
    staffId,
    lifetimeXp: Number(result.lifetimeXp || 0),
    weekXp: Number(result.weekXp || 0),
    todayXp: Number(result.todayXp || 0),
    rewardCredits: {
      ledgerBalance: Number(rewardRaw.ledgerBalance || 0),
      reservedBalance: Number(rewardRaw.reservedBalance || 0),
      availableBalance: Number(rewardRaw.availableBalance || 0),
      valid: rewardRaw.valid === true,
    },
    eventCounts,
    weeklyPerformance: weeklyRaw
      ? {
          weekStart: String(weeklyRaw.weekStart || "").trim(),
          weekEnd: String(weeklyRaw.weekEnd || "").trim(),
          normalizedScore: Number(weeklyRaw.normalizedScore || 0),
          rank:
            weeklyRaw.rank === null || weeklyRaw.rank === undefined
              ? null
              : Number(weeklyRaw.rank),
          status: String(weeklyRaw.status || "").trim(),
          calculationVersion: String(weeklyRaw.calculationVersion || "").trim(),
        }
      : null,
  };
}

export async function recordVerifiedGamificationEvent(
  scope: TenantScope,
  input: VerifiedGamificationEventInput
): Promise<VerifiedGamificationEventResult> {
  const result = await callGamification<{
    eventId?: unknown;
    xpAwarded?: unknown;
    duplicate?: unknown;
  }>(
    scope,
    "record_verified_event",
    input as unknown as Record<string, unknown>,
    3_000
  );

  const eventId = String(result.eventId || "").trim();
  if (!eventId) throw new Error("GAMIFICATION_EVENT_ID_MISSING");
  return {
    eventId,
    xpAwarded: Number(result.xpAwarded || 0),
    duplicate: Boolean(result.duplicate),
  };
}
