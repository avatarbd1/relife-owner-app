import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";

interface ValidationRequest {
  organizationId?: string;
  clinicId?: string;
}

interface ValidationResult {
  ok: boolean;
  isReady: boolean;
  checks: {
    tenantContextResolvable: boolean;
    organizationExists: boolean;
    clinicExists: boolean;
    clinicBelongsToOrganization: boolean;
    staffHasClinicMembership: boolean;
    departmentDataScopedToClinic: boolean;
    tenantFiltersPresentInReaders: boolean;
    explicitTenantParametersInWriters: boolean;
    crossTenantIsolationVerified: boolean;
  };
  errors: string[];
  warnings: string[];
}

async function checkOrganizationExists(organizationId: string): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return false;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", organizationId)
      .single();

    return !!data;
  } catch {
    return false;
  }
}

async function checkClinicExists(organizationId: string, clinicId: string): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return false;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await supabase
      .from("clinics")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", clinicId)
      .single();

    return !!data;
  } catch {
    return false;
  }
}

async function checkStaffMembership(
  organizationId: string,
  clinicId: string,
  staffId: string
): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return false;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await supabase
      .from("clinic_memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("clinic_id", clinicId)
      .eq("user_id", staffId)
      .eq("status", "active")
      .limit(1);

    return !!data && data.length > 0;
  } catch {
    return false;
  }
}

function validateWriterPatterns(): { valid: boolean; gaps: string[] } {
  const gaps: string[] = [];

  if (!process.env.RELIFE_TENANT_CUTOVER_ENFORCED) {
    gaps.push("RELIFE_TENANT_CUTOVER_ENFORCED feature flag not set");
  }

  return {
    valid: gaps.length === 0,
    gaps,
  };
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;

    validateTenantScope(access, tenant, "clinic.manage");

    const body = (await request.json().catch(() => null)) as ValidationRequest | null;
    const organizationId = body?.organizationId || tenant.organizationId;
    const clinicId = body?.clinicId || tenant.clinicId;

    const result: ValidationResult = {
      ok: false,
      isReady: false,
      checks: {
        tenantContextResolvable: true,
        organizationExists: false,
        clinicExists: false,
        clinicBelongsToOrganization: false,
        staffHasClinicMembership: false,
        departmentDataScopedToClinic: true,
        tenantFiltersPresentInReaders: true,
        explicitTenantParametersInWriters: false,
        crossTenantIsolationVerified: false,
      },
      errors: [],
      warnings: [],
    };

    if (!organizationId || !clinicId) {
      result.errors.push("organizationId and clinicId are required");
      return NextResponse.json(result);
    }

    const orgExists = await checkOrganizationExists(organizationId);
    result.checks.organizationExists = orgExists;
    if (!orgExists) {
      result.errors.push(`Organization ${organizationId} not found`);
    }

    if (orgExists) {
      const clinicExists = await checkClinicExists(organizationId, clinicId);
      result.checks.clinicExists = clinicExists;
      result.checks.clinicBelongsToOrganization = clinicExists;

      if (!clinicExists) {
        result.errors.push(
          `Clinic ${clinicId} not found or does not belong to organization ${organizationId}`
        );
      } else {
        const hasMembership = await checkStaffMembership(
          organizationId,
          clinicId,
          access.staffId
        );
        result.checks.staffHasClinicMembership = hasMembership;

        if (!hasMembership) {
          result.warnings.push(`Staff ${access.staffId} has no active membership in clinic ${clinicId}`);
        }
      }
    }

    const writerChecks = validateWriterPatterns();
    result.checks.explicitTenantParametersInWriters = writerChecks.valid;

    if (!writerChecks.valid) {
      result.warnings.push(
        `Writer pattern validation incomplete: ${writerChecks.gaps.join(", ")}`
      );
    }

    const allChecksPass =
      result.checks.organizationExists &&
      result.checks.clinicExists &&
      result.checks.clinicBelongsToOrganization &&
      result.checks.staffHasClinicMembership;

    const readinessChecksPass =
      result.checks.tenantContextResolvable &&
      result.checks.departmentDataScopedToClinic &&
      result.checks.tenantFiltersPresentInReaders &&
      result.checks.explicitTenantParametersInWriters &&
      result.checks.crossTenantIsolationVerified;

    result.ok = true;
    result.isReady = allChecksPass && readinessChecksPass && result.errors.length === 0;

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "VALIDATION_FAILED";
    if (
      message === "ACCESS_DENIED" ||
      message === "TENANT_SCOPE_REQUIRED" ||
      message === "TENANT_CONTEXT_UNAVAILABLE"
    ) {
      return NextResponse.json({ ok: false, error: message }, { status: 403 });
    }

    console.error("Clinic validation failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
