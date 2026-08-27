import "server-only";

import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";
import { requireAuthorizedTenantSelection } from "@/lib/domain/tenancy/tenantSelection";

const DEFAULT_TENANT_CONTEXT_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-tenant-context";
const EDGE_TIMEOUT_MS = 5000;

export type StaffTenantContext = TenantScope & {
  staffId: string;
  organizationSlug: string;
  organizationName: string;
  clinicSlug: string;
  clinicName: string;
  timezone: string;
};

type TenantPayload = {
  ok?: boolean;
  error?: unknown;
  staffId?: unknown;
  tenant?: {
    organizationId?: unknown;
    organizationSlug?: unknown;
    organizationName?: unknown;
    clinicId?: unknown;
    clinicSlug?: unknown;
    clinicName?: unknown;
    timezone?: unknown;
  };
  tenants?: TenantPayload["tenant"][];
};

function tenantContextSecret(): string {
  const secret = (
    process.env.RELIFE_TENANT_CONTEXT_SECRET ||
    process.env.RELIFE_MUTATION_LOCK_SECRET ||
    ""
  ).trim();
  if (!secret) throw new Error("TENANT_CONTEXT_SECRET_MISSING");
  return secret;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanStaffId(value: string): string {
  const staffId = value.trim();
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(staffId)) {
    throw new Error("INVALID_STAFF_ID");
  }
  return staffId;
}

function parseTenant(payload: NonNullable<TenantPayload["tenant"]>): Omit<StaffTenantContext, "staffId"> {
  const scope = requireTenantScope({
    organizationId: cleanText(payload.organizationId),
    clinicId: cleanText(payload.clinicId),
  });
  const organizationSlug = cleanText(payload.organizationSlug);
  const organizationName = cleanText(payload.organizationName);
  const clinicSlug = cleanText(payload.clinicSlug);
  const clinicName = cleanText(payload.clinicName);
  const timezone = cleanText(payload.timezone);
  if (!organizationSlug || !organizationName || !clinicSlug || !clinicName || !timezone) {
    throw new Error("TENANT_CONTEXT_INCOMPLETE");
  }
  return { ...scope, organizationSlug, organizationName, clinicSlug, clinicName, timezone };
}

export function parseStaffTenantPayload(
  requestedStaffId: string,
  payload: TenantPayload
): StaffTenantContext {
  if (payload.ok !== true || !payload.tenant) {
    throw new Error(cleanText(payload.error) || "TENANT_CONTEXT_UNAVAILABLE");
  }

  const staffId = cleanStaffId(cleanText(payload.staffId));
  if (staffId !== requestedStaffId) {
    throw new Error("TENANT_CONTEXT_STAFF_MISMATCH");
  }

  return { ...parseTenant(payload.tenant), staffId };
}

export type StaffTenantResolution = {
  selected: StaffTenantContext;
  available: StaffTenantContext[];
};

export function parseStaffTenantResolution(requestedStaffId: string, payload: TenantPayload): StaffTenantResolution {
  const selected = parseStaffTenantPayload(requestedStaffId, payload);
  const rows = payload.tenants || [];
  const available = rows.map((tenant) => ({ ...parseTenant(tenant || {}), staffId: selected.staffId }));
  try { requireAuthorizedTenantSelection(available, selected); }
  catch { throw new Error("TENANT_CONTEXT_SELECTION_MISMATCH"); }
  return { selected, available };
}

export async function resolveStaffTenantContext(
  rawStaffId: string,
  requestedScope?: TenantScope | null
): Promise<StaffTenantContext> {
  return (await resolveStaffTenantContexts(rawStaffId, requestedScope)).selected;
}

export async function resolveStaffTenantContexts(
  rawStaffId: string,
  requestedScope?: TenantScope | null
): Promise<StaffTenantResolution> {
  const staffId = cleanStaffId(rawStaffId);
  const scope = requestedScope ? requireTenantScope(requestedScope) : null;
  const url = (
    process.env.RELIFE_SUPABASE_TENANT_CONTEXT_URL || DEFAULT_TENANT_CONTEXT_URL
  ).trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-lock-key": tenantContextSecret(),
      },
      body: JSON.stringify({ staffId, ...(scope ? { organizationId: scope.organizationId, clinicId: scope.clinicId } : {}) }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as TenantPayload;
    if (!response.ok) {
      throw new Error(cleanText(payload.error) || `TENANT_CONTEXT_HTTP_${response.status}`);
    }
    return parseStaffTenantResolution(staffId, payload);
  } finally {
    clearTimeout(timeout);
  }
}
