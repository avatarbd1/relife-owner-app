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
  /**
   * Checks whose evidence is a deployment assertion (an enforcement flag)
   * rather than a runtime probe. They still gate `isReady`, but a caller must
   * not read them as proof that the property was independently observed.
   */
  unverified: string[];
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

/**
 * Probe for dual-key contamination on the requested clinic.
 *
 * `(organization_id, clinic_id)` is only an isolation boundary while the two
 * keys agree with the canonical `clinics (organization_id, id)` mapping. A row
 * carrying this clinic under a different organization means dual-key filtering
 * silently returns the wrong tenant's data, so any such row fails the check.
 *
 * Read-only, and fails closed when a probe cannot run.
 */
async function checkCrossTenantIsolation(
  organizationId: string,
  clinicId: string
): Promise<{ verified: boolean; gaps: string[] }> {
  const gaps: string[] = [];

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return { verified: false, gaps: ["Supabase service credentials unavailable"] };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const probes: { table: string; column: string }[] = [
      { table: "clinics", column: "id" },
      { table: "clinic_memberships", column: "clinic_id" },
    ];

    for (const probe of probes) {
      const { data, error } = await supabase
        .from(probe.table)
        .select(probe.column)
        .eq(probe.column, clinicId)
        .neq("organization_id", organizationId)
        .limit(1);

      if (error) {
        gaps.push(`${probe.table} isolation probe failed: ${error.message}`);
        continue;
      }

      if (data && data.length > 0) {
        gaps.push(
          `${probe.table} has rows for clinic ${clinicId} under an organization other than ${organizationId}`
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { verified: false, gaps: [`Cross-tenant isolation probe failed: ${message}`] };
  }

  return { verified: gaps.length === 0, gaps };
}

/**
 * Reader and writer tenant-parameter coverage is a source property, so it
 * cannot be observed from a running request. Both checks therefore rest on the
 * same single deployment assertion, and this returns one shared result rather
 * than two lookalike helpers that would imply two independent proofs.
 *
 * Callers must list the checks it backs in `result.unverified`.
 */
function validateTenantEnforcementFlag(): { valid: boolean; gaps: string[] } {
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
        tenantContextResolvable: false,
        organizationExists: false,
        clinicExists: false,
        clinicBelongsToOrganization: false,
        staffHasClinicMembership: false,
        departmentDataScopedToClinic: false,
        tenantFiltersPresentInReaders: false,
        explicitTenantParametersInWriters: false,
        crossTenantIsolationVerified: false,
      },
      errors: [],
      warnings: [],
      unverified: [],
    };

    // Evaluated, not asserted: validateTenantScope above already rejects a
    // blank organization/clinic/staff binding, so this records the observed
    // context rather than restating that guarantee as a literal.
    result.checks.tenantContextResolvable = Boolean(
      tenant.organizationId?.trim() &&
        tenant.clinicId?.trim() &&
        tenant.staffId?.trim()
    );

    // Department is authorization scope, never a stand-in for clinic identity,
    // so readiness requires an explicit department scope alongside the clinic
    // key rather than an implicit global one.
    const departmentAccess = access.departmentAccess || [];
    result.checks.departmentDataScopedToClinic =
      departmentAccess.length > 0 && Boolean(tenant.clinicId?.trim());

    if (!result.checks.departmentDataScopedToClinic) {
      result.warnings.push(
        `Staff ${access.staffId} has no explicit department scope bound to a clinic`
      );
    }

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

    const enforcementFlag = validateTenantEnforcementFlag();
    result.checks.tenantFiltersPresentInReaders = enforcementFlag.valid;
    result.checks.explicitTenantParametersInWriters = enforcementFlag.valid;
    result.unverified.push(
      "tenantFiltersPresentInReaders",
      "explicitTenantParametersInWriters"
    );

    if (!enforcementFlag.valid) {
      result.warnings.push(
        `Reader/writer tenant parameter enforcement not asserted: ${enforcementFlag.gaps.join(", ")}`
      );
    }

    const isolationChecks = await checkCrossTenantIsolation(organizationId, clinicId);
    result.checks.crossTenantIsolationVerified = isolationChecks.verified;

    if (!isolationChecks.verified) {
      result.warnings.push(
        `Cross-tenant isolation not verified: ${isolationChecks.gaps.join(", ")}`
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
