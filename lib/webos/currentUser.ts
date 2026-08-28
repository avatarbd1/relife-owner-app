import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionStaffId } from "@/lib/auth";
import { isPlatformOwnerStaffId } from "@/lib/domain/platform/authority";
import {
  resolveStaffTenantContext,
  type StaffTenantContext,
} from "@/lib/domain/tenancy/staffTenantContext";
import type { AccessContext } from "@/lib/webos/access";
import { ACTIVE_TENANT_COOKIE, parseTenantSelection } from "@/lib/domain/tenancy/tenantSelection";
import {
  getActiveWebStaffById,
  toAccessContext,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";
import { getTenantScopedWebStaffIdentity } from "@/lib/webos/tenantStaffDirectory";

async function currentSessionStaffId(): Promise<string | null> {
  const cookieStore = await cookies();
  return getSessionStaffId(cookieStore.get(SESSION_COOKIE)?.value);
}

async function currentTenantSelection() {
  const cookieStore = await cookies();
  return parseTenantSelection(cookieStore.get(ACTIVE_TENANT_COOKIE)?.value);
}

function isPlatformOwner(staffId: string): boolean {
  return isPlatformOwnerStaffId(
    staffId,
    String(process.env.PLATFORM_OWNER_STAFF_IDS || "").trim(),
  );
}

export function isOwnerTenantCutoverEnforced(): boolean {
  return process.env.RELIFE_TENANT_CUTOVER_ENFORCED?.trim().toLowerCase() === "true";
}

async function enforceOwnerTenantBinding(identity: WebStaffIdentity): Promise<void> {
  if (!isOwnerTenantCutoverEnforced() || !identity.roles.includes("Owner")) return;
  // The resolver is fail-closed: missing, inactive, or ambiguous Tenant/Clinic
  // bindings reject the Owner session before any downstream operational action.
  await resolveStaffTenantContext(identity.staffId);
}

export async function getCurrentStaffIdentity(): Promise<WebStaffIdentity | null> {
  const staffId = await currentSessionStaffId();
  if (!staffId) return null;

  // Platform authority is intentionally outside clinic tenancy.
  if (isPlatformOwner(staffId)) {
    return getActiveWebStaffById(staffId);
  }

  try {
    const tenant = await resolveStaffTenantContext(staffId, await currentTenantSelection());
    return await getTenantScopedWebStaffIdentity(staffId, tenant);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TENANT_CONTEXT_UNAVAILABLE";
    if (message !== "TENANT_BINDING_NOT_FOUND") throw error;

    // Temporary compatibility only for pre-cutover Relife staff that have not
    // received a tenant binding yet. New SaaS tenant staff never depend on it.
    const legacy = await getActiveWebStaffById(staffId);
    if (!legacy) return null;
    await enforceOwnerTenantBinding(legacy);
    return legacy;
  }
}

export async function getCurrentAccessContext(): Promise<AccessContext | null> {
  const identity = await getCurrentStaffIdentity();
  return identity ? toAccessContext(identity) : null;
}

export async function requireCurrentAccessContext(): Promise<AccessContext> {
  const context = await getCurrentAccessContext();
  if (!context) throw new Error("ACCESS_DENIED");
  return context;
}

/**
 * Resolve the canonical Tenant/Clinic for the existing signed staff session.
 * Missing or ambiguous tenant bindings fail closed; there is no implicit
 * fallback to Relife.
 */
export async function getCurrentTenantContext(): Promise<StaffTenantContext | null> {
  const staffId = await currentSessionStaffId();
  if (!staffId) return null;
  return resolveStaffTenantContext(staffId, await currentTenantSelection());
}

export async function requireCurrentTenantContext(): Promise<StaffTenantContext> {
  const tenant = await getCurrentTenantContext();
  if (!tenant) throw new Error("ACCESS_DENIED");
  return tenant;
}

export type CurrentTenantAccessContext = {
  identity: WebStaffIdentity;
  access: AccessContext;
  tenant: StaffTenantContext;
};

/** Canonical server context for tenant-aware operational routes. */
export async function getCurrentTenantAccessContext(): Promise<CurrentTenantAccessContext | null> {
  const identity = await getCurrentStaffIdentity();
  if (!identity) return null;
  const access = toAccessContext(identity);
  if (!access) return null;
  const tenant = await resolveStaffTenantContext(identity.staffId, await currentTenantSelection());
  return {
    identity,
    access,
    tenant,
  };
}

export async function requireCurrentTenantAccessContext(): Promise<CurrentTenantAccessContext> {
  const context = await getCurrentTenantAccessContext();
  if (!context) throw new Error("ACCESS_DENIED");
  return context;
}
