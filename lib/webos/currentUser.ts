import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionStaffId } from "@/lib/auth";
import { isPlatformOwnerStaffId } from "@/lib/domain/platform/authority";
import {
  resolveStaffTenantContext,
  type StaffTenantContext,
} from "@/lib/domain/tenancy/staffTenantContext";
import { ACTIVE_TENANT_COOKIE, parseTenantSelection } from "@/lib/domain/tenancy/tenantSelection";
import type { AccessContext } from "@/lib/webos/access";
import {
  toAccessContext,
  type WebStaffIdentity,
} from "@/lib/webos/staffDirectory";
import { getTenantScopedWebStaffIdentity } from "@/lib/webos/tenantStaffDirectory";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { clinicRuntimeDepartments } from "@/lib/domain/tenancy/clinicRuntime";
import { isRelifeLegacyTenant } from "@/lib/config/relifeSystem";

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

async function resolveCurrentTenantForStaff(staffId: string): Promise<StaffTenantContext | null> {
  if (isPlatformOwner(staffId)) return null;
  try {
    return await resolveStaffTenantContext(staffId, await currentTenantSelection());
  } catch (error) {
    const message = error instanceof Error ? error.message : "TENANT_CONTEXT_UNAVAILABLE";
    if (message === "TENANT_BINDING_NOT_FOUND") return null;
    throw error;
  }
}

async function scopeIdentityToClinic(
  identity: WebStaffIdentity,
  tenant: StaffTenantContext,
): Promise<WebStaffIdentity | null> {
  if (isRelifeLegacyTenant(tenant)) return identity;
  const configuration = await readClinicConfiguration(tenant);
  const departments = clinicRuntimeDepartments(configuration.profile?.clinicType);
  if (departments.length !== 1) return null;
  const department = departments[0];
  if (
    (department === "Physio" && identity.roles.some((role) => role === "Dentist" || role === "Dental_Assistant")) ||
    (department === "Dental" && identity.roles.includes("Therapist"))
  ) {
    return null;
  }
  return {
    ...identity,
    primaryDepartment: department,
    departmentAccess: [department],
  };
}

export async function getCurrentStaffIdentity(): Promise<WebStaffIdentity | null> {
  const staffId = await currentSessionStaffId();
  if (!staffId || isPlatformOwner(staffId)) return null;

  const tenant = await resolveCurrentTenantForStaff(staffId);
  if (!tenant) return null;
  const identity = await getTenantScopedWebStaffIdentity(staffId, tenant);
  return identity ? scopeIdentityToClinic(identity, tenant) : null;
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
 * Resolve the canonical Tenant/Clinic for a clinic staff session. Platform
 * Owner authority is deliberately excluded and has its own control-plane
 * session resolver.
 */
export async function getCurrentTenantContext(): Promise<StaffTenantContext | null> {
  const staffId = await currentSessionStaffId();
  if (!staffId) return null;
  return resolveCurrentTenantForStaff(staffId);
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
  const staffId = await currentSessionStaffId();
  if (!staffId || isPlatformOwner(staffId)) return null;

  const tenant = await resolveCurrentTenantForStaff(staffId);
  if (!tenant) return null;
  const rawIdentity = await getTenantScopedWebStaffIdentity(staffId, tenant);
  const identity = rawIdentity ? await scopeIdentityToClinic(rawIdentity, tenant) : null;
  if (!identity) return null;
  const access = toAccessContext(identity);
  if (!access) return null;
  return { identity, access, tenant };
}

export async function requireCurrentTenantAccessContext(): Promise<CurrentTenantAccessContext> {
  const context = await getCurrentTenantAccessContext();
  if (!context) throw new Error("ACCESS_DENIED");
  return context;
}
