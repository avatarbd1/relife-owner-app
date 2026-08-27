export const TENANT_ROLE_CODES = [
  "owner",
  "manager",
  "receptionist",
  "therapist",
  "dentist",
  "dental_assistant",
  "auditor",
  "system_admin",
] as const;

export type TenantRoleCode = (typeof TENANT_ROLE_CODES)[number];

export const KERNEL_PERMISSION_CODES = [
  "tenant.read",
  "tenant.manage",
  "clinic.read",
  "clinic.manage",
  "membership.read",
  "membership.manage",
  "department.read",
  "department.manage",
  "audit.read",
  "analytics.aggregate.read",
  "analytics.export",
] as const;

export type KernelPermissionCode = (typeof KERNEL_PERMISSION_CODES)[number];

const LEGACY_ROLE_MAP: Readonly<Record<string, TenantRoleCode>> = {
  owner: "owner",
  manager: "manager",
  receptionist: "receptionist",
  therapist: "therapist",
  dentist: "dentist",
  dental_assistant: "dental_assistant",
  "dental assistant": "dental_assistant",
  auditor: "auditor",
  system_admin: "system_admin",
  "system admin": "system_admin",
};

export interface TenantScope {
  organizationId: string;
  clinicId: string;
}

/**
 * Compatibility normalizer for legacy Staff/Telegram role labels.
 * Unknown or blank roles fail closed instead of being widened to a default role.
 */
export function normalizeTenantRole(value: unknown): TenantRoleCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  return LEGACY_ROLE_MAP[normalized] ?? null;
}

export function isTenantRoleCode(value: unknown): value is TenantRoleCode {
  return (
    typeof value === "string" &&
    (TENANT_ROLE_CODES as readonly string[]).includes(value)
  );
}

export function requireTenantScope(scope: Partial<TenantScope> | null | undefined): TenantScope {
  const organizationId = scope?.organizationId?.trim();
  const clinicId = scope?.clinicId?.trim();
  if (!organizationId || !clinicId) {
    throw new Error("TENANT_SCOPE_REQUIRED");
  }
  return { organizationId, clinicId };
}
