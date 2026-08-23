import "server-only";

import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";

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

  const scope = requireTenantScope({
    organizationId: cleanText(payload.tenant.organizationId),
    clinicId: cleanText(payload.tenant.clinicId),
  });
  const organizationSlug = cleanText(payload.tenant.organizationSlug);
  const organizationName = cleanText(payload.tenant.organizationName);
  const clinicSlug = cleanText(payload.tenant.clinicSlug);
  const clinicName = cleanText(payload.tenant.clinicName);
  const timezone = cleanText(payload.tenant.timezone);

  if (!organizationSlug || !organizationName || !clinicSlug || !clinicName || !timezone) {
    throw new Error("TENANT_CONTEXT_INCOMPLETE");
  }

  return {
    ...scope,
    staffId,
    organizationSlug,
    organizationName,
    clinicSlug,
    clinicName,
    timezone,
  };
}

export async function resolveStaffTenantContext(
  rawStaffId: string
): Promise<StaffTenantContext> {
  const staffId = cleanStaffId(rawStaffId);
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
      body: JSON.stringify({ staffId }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as TenantPayload;
    if (!response.ok) {
      throw new Error(cleanText(payload.error) || `TENANT_CONTEXT_HTTP_${response.status}`);
    }
    return parseStaffTenantPayload(staffId, payload);
  } finally {
    clearTimeout(timeout);
  }
}
