import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionStaffId } from "@/lib/auth";
import {
  resolveStaffTenantContext,
  type StaffTenantContext,
} from "@/lib/domain/tenancy/staffTenantContext";
import type { AccessContext } from "@/lib/webos/access";
import {
  getActiveWebStaffById,
  toAccessContext,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";

async function currentSessionStaffId(): Promise<string | null> {
  const cookieStore = await cookies();
  return getSessionStaffId(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function getCurrentStaffIdentity(): Promise<WebStaffIdentity | null> {
  const staffId = await currentSessionStaffId();
  if (!staffId) return null;
  return getActiveWebStaffById(staffId);
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
 *
 * This is additive during the Relife Tenant #1 cutover: legacy routes may keep
 * using getCurrentAccessContext while migrated routes opt into this resolver.
 * Missing or ambiguous tenant bindings fail closed; there is no implicit
 * fallback to Relife.
 */
export async function getCurrentTenantContext(): Promise<StaffTenantContext | null> {
  const staffId = await currentSessionStaffId();
  if (!staffId) return null;
  return resolveStaffTenantContext(staffId);
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

/** Canonical migration target for tenant-aware server routes. */
export async function getCurrentTenantAccessContext(): Promise<CurrentTenantAccessContext | null> {
  const identity = await getCurrentStaffIdentity();
  if (!identity) return null;
  const tenant = await resolveStaffTenantContext(identity.staffId);
  return {
    identity,
    access: toAccessContext(identity),
    tenant,
  };
}

export async function requireCurrentTenantAccessContext(): Promise<CurrentTenantAccessContext> {
  const context = await getCurrentTenantAccessContext();
  if (!context) throw new Error("ACCESS_DENIED");
  return context;
}
