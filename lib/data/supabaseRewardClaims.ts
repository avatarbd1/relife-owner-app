import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { RelifeDepartment } from "@/lib/config/relifeSystem";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import type { WebRole } from "@/lib/webos/access";

export type RewardClaimStatus = "pending" | "approved" | "denied" | "cancelled" | "claimed" | "expired";
export type RewardClaimTransition = "approve" | "deny" | "cancel" | "claim";

export interface RewardClaimRecord {
  id: string;
  staffId: string;
  department: string;
  rewardKey: string;
  redemptionType: string;
  creditCost: number;
  requestedFor: string | null;
  requestNotes: string;
  coverageStatus: string;
  status: RewardClaimStatus;
  decisionReason: string;
  requestedAt: string | null;
  ownerDecisionBy: string | null;
  ownerDecisionAt: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  stateVersion: number;
  configVersion: number | null;
  policySnapshot: Record<string, unknown>;
  eligibleAfter: string | null;
}

export interface RewardCreditBalanceSnapshot {
  ledgerBalance: number;
  reservedBalance: number;
  availableBalance: number;
  valid: boolean;
}

export interface RewardClaimActor {
  actorId: string;
  actorRoles: WebRole[];
  actorDepartmentAccess: string[];
}

export interface RewardClaimRequestInput extends RewardClaimActor {
  requestId: string;
  idempotencyKey: string;
  organizationId: string;
  clinicId: string;
  staffId: string;
  department: RelifeDepartment;
  rewardKey: string;
  requestedFor?: string | null;
  requestNotes?: string;
}

export interface RewardClaimActionInput extends RewardClaimActor {
  requestId: string;
  idempotencyKey: string;
  organizationId: string;
  clinicId: string;
  claimId: string;
  transition: RewardClaimTransition;
  expectedVersion: number;
  reason?: string;
  coverageStatus?: "available" | "unavailable" | "";
}

const DEFAULT_REWARD_CLAIMS_EDGE_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-reward-claims-api";

function endpoint(): string {
  return (process.env.RELIFE_SUPABASE_REWARD_CLAIMS_EDGE_URL || DEFAULT_REWARD_CLAIMS_EDGE_URL).trim();
}

function edgeSecret(): string {
  return (process.env.RELIFE_GAMIFICATION_EDGE_SECRET || process.env.RELIFE_EDGE_SECRET || "").trim();
}

export function rewardClaimsConfigured(): boolean {
  return Boolean(endpoint() && edgeSecret());
}

async function resolveTenantSlugs(organizationId: string, clinicId: string): Promise<{ organizationSlug: string; clinicSlug: string }> {
  const tenant = requireTenantScope({ organizationId, clinicId });
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("GAMIFICATION_TENANT_STORE_UNAVAILABLE");
  const relife = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).schema("relife");
  const [organization, clinic] = await Promise.all([
    relife.from("organizations").select("slug,status").eq("id", tenant.organizationId).maybeSingle(),
    relife.from("clinics").select("slug,status,organization_id").eq("organization_id", tenant.organizationId).eq("id", tenant.clinicId).maybeSingle(),
  ]);
  if (organization.error || clinic.error) throw new Error("GAMIFICATION_TENANT_RESOLUTION_FAILED");
  const organizationSlug = String(organization.data?.slug || "").trim();
  const clinicSlug = String(clinic.data?.slug || "").trim();
  if (!organizationSlug || !clinicSlug || String(organization.data?.status || "").toLowerCase() !== "active" || String(clinic.data?.status || "").toLowerCase() !== "active") {
    throw new Error("GAMIFICATION_TENANT_NOT_ACTIVE");
  }
  return { organizationSlug, clinicSlug };
}

async function callClaims<T>(
  action: string,
  payload: Record<string, unknown>,
  organizationId: string,
  clinicId: string,
  timeoutMs = 5_000
): Promise<T> {
  const secret = edgeSecret();
  if (!secret) throw new Error("GAMIFICATION_EDGE_SECRET_MISSING");
  const tenant = await resolveTenantSlugs(organizationId, clinicId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-relife-server-key": secret },
      body: JSON.stringify({ action, organizationSlug: tenant.organizationSlug, clinicSlug: tenant.clinicSlug, ...payload }),
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

export async function listRewardClaims(input: RewardClaimActor & { organizationId: string; clinicId: string; status?: RewardClaimStatus | "all" }): Promise<RewardClaimRecord[]> {
  const result = await callClaims<{ claims?: unknown }>("claims_list", {
    actorId: input.actorId,
    actorRoles: input.actorRoles,
    actorDepartmentAccess: input.actorDepartmentAccess,
    status: input.status || "pending",
  }, input.organizationId, input.clinicId);
  return Array.isArray(result.claims) ? (result.claims as RewardClaimRecord[]) : [];
}

export async function requestRewardClaim(input: RewardClaimRequestInput): Promise<{
  claimId: string;
  status: RewardClaimStatus;
  stateVersion: number;
  duplicate: boolean;
  reservedCredits?: number;
  availableCreditsAfterReserve?: number;
}> {
  return callClaims("claim_request", input as unknown as Record<string, unknown>, input.organizationId, input.clinicId, 5_000);
}

export async function actOnRewardClaim(input: RewardClaimActionInput): Promise<{
  claimId: string;
  status: RewardClaimStatus;
  stateVersion: number;
  duplicate: boolean;
  rewardCredits?: RewardCreditBalanceSnapshot;
  settlementRequired?: boolean;
}> {
  return callClaims("claim_action", input as unknown as Record<string, unknown>, input.organizationId, input.clinicId, 5_000);
}
