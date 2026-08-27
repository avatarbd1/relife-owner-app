import { requireTenantScope, type TenantScope } from "./policy.ts";

export const ACTIVE_TENANT_COOKIE = "relife_active_tenant";

export function serializeTenantSelection(scope: TenantScope): string {
  const tenant = requireTenantScope(scope);
  return `${encodeURIComponent(tenant.organizationId)}:${encodeURIComponent(tenant.clinicId)}`;
}

export function parseTenantSelection(value: string | null | undefined): TenantScope | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  try {
    return requireTenantScope({
      organizationId: decodeURIComponent(parts[0]),
      clinicId: decodeURIComponent(parts[1]),
    });
  } catch {
    return null;
  }
}

export function requireAuthorizedTenantSelection<T extends TenantScope>(
  available: readonly T[],
  requested: Partial<TenantScope> | null | undefined
): T {
  const scope = requireTenantScope(requested);
  const selected = available.find((tenant) =>
    tenant.organizationId === scope.organizationId && tenant.clinicId === scope.clinicId
  );
  if (!selected) throw new Error("TENANT_SELECTION_NOT_AUTHORIZED");
  return selected;
}
