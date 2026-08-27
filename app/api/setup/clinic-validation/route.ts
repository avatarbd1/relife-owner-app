import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { listStoredStaffProvisioning } from "@/lib/data/staffProvisioning";
import { buildProvisioningDryRun } from "@/lib/domain/tenancy/provisioningPlan";
import { evaluateClinicReadiness, readinessPass, readinessFail, readinessUnverified, type TrustedReadinessEvidence } from "@/lib/domain/tenancy/readinessEngine";
import { loadStaffMembership } from "@/lib/domain/tenancy/staffAuthorization";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

const REQUIRED_SCHEMA_TABLES = [
  "organizations", "clinics", "clinic_settings", "clinic_operating_hours", "feature_catalog",
  "clinic_feature_flags", "clinic_entitlements", "clinic_services", "clinic_rooms", "clinic_resources",
  "clinic_booking_config", "staff_tenant_bindings", "staff_tenant_roles", "staff_tenant_departments",
] as const;

async function collectSchemaEvidence(client: SupabaseClient) {
  const relife = client.schema("relife");
  const failures: string[] = [];
  for (const table of REQUIRED_SCHEMA_TABLES) {
    const result = await relife.from(table).select("*", { count: "exact", head: true }).limit(1);
    if (result.error) failures.push(`${table}: ${result.error.message}`);
  }
  return failures.length === 0
    ? readinessPass([`required schema surfaces reachable: ${REQUIRED_SCHEMA_TABLES.join(", ")}`])
    : readinessFail(failures);
}

async function collectCrossTenantEvidence(client: SupabaseClient, organizationId: string, clinicId: string) {
  const relife = client.schema("relife");
  const tables = [
    "clinic_settings", "clinic_operating_hours", "clinic_feature_flags", "clinic_entitlements",
    "clinic_services", "clinic_rooms", "clinic_resources", "clinic_booking_config", "staff_tenant_bindings",
  ] as const;
  const conflicts: string[] = [];
  for (const table of tables) {
    const result = await relife.from(table)
      .select("clinic_id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .neq("organization_id", organizationId);
    if (result.error) conflicts.push(`${table} probe failed: ${result.error.message}`);
    else if ((result.count || 0) > 0) conflicts.push(`${table} has ${result.count} cross-organization row(s) for clinic_id`);
  }
  return conflicts.length === 0
    ? readinessPass(["critical configuration and staff tables contain no same-clinic cross-organization rows"])
    : readinessFail(conflicts);
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    validateTenantScope(access, tenant, "clinic.manage");
    if (!canPerform(access, "settings.manage", "Physio") && !canPerform(access, "settings.manage", "Dental")) {
      return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { organizationId?: string; clinicId?: string };
    const organizationId = String(body.organizationId || tenant.organizationId).trim();
    const clinicId = String(body.clinicId || tenant.clinicId).trim();
    if (organizationId !== tenant.organizationId || clinicId !== tenant.clinicId) {
      return NextResponse.json({ ok: false, error: "TENANT_SCOPE_MISMATCH" }, { status: 403 });
    }

    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) return NextResponse.json({ ok: false, error: "CONFIGURATION_STORE_UNAVAILABLE" }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const relife = client.schema("relife");

    const [organizationResult, clinicResult, membership, configuration, staffProvisioning, schemaEvidence, isolationEvidence] = await Promise.all([
      relife.from("organizations").select("id").eq("id", organizationId).maybeSingle(),
      relife.from("clinics").select("id,organization_id,status").eq("organization_id", organizationId).eq("id", clinicId).maybeSingle(),
      loadStaffMembership(client, { organizationId, clinicId }, access.staffId),
      readClinicConfiguration({ organizationId, clinicId }, client),
      listStoredStaffProvisioning({ organizationId, clinicId }, client),
      collectSchemaEvidence(client),
      collectCrossTenantEvidence(client, organizationId, clinicId),
    ]);

    const organizationExists = organizationResult.error
      ? readinessFail([`organization probe failed: ${organizationResult.error.message}`])
      : organizationResult.data ? readinessPass(["organization row exists"]) : readinessFail(["organization row missing"]);
    const clinicExists = clinicResult.error
      ? readinessFail([`clinic probe failed: ${clinicResult.error.message}`])
      : clinicResult.data ? readinessPass(["clinic row exists"]) : readinessFail(["clinic row missing"]);
    const clinicBelongsToOrganization = clinicResult.data && String((clinicResult.data as { organization_id?: string }).organization_id || "") === organizationId
      ? readinessPass(["clinic.organization_id matches requested organization"])
      : readinessFail(["clinic does not belong to requested organization"]);

    let rollbackEvidence = readinessUnverified("provisioning dry-run could not be produced");
    try {
      const dryRun = buildProvisioningDryRun({ organizationId, clinicId }, configuration);
      rollbackEvidence = dryRun.reversible
        ? readinessPass(dryRun.evidence)
        : readinessFail(["provisioning plan contains a mutating step without compensation"]);
    } catch (error) {
      rollbackEvidence = readinessFail([error instanceof Error ? error.message : "PROVISIONING_DRY_RUN_FAILED"]);
    }

    const runtimeAttested = process.env.PHASE_F_TENANT_RUNTIME_ATTESTATION === "phase-f-no-relife-fallback-v1";
    const evidence: TrustedReadinessEvidence = {
      organizationExists,
      clinicExists,
      clinicBelongsToOrganization,
      databaseSchemaReady: schemaEvidence,
      crossTenantIsolationVerified: isolationEvidence,
      provisioningRollbackEvidencePresent: rollbackEvidence,
      noRelifeDefaultsInActivePath: runtimeAttested
        ? readinessPass(["deployment carries phase-f-no-relife-fallback-v1 runtime attestation; CI static guard must pass for this release"])
        : readinessUnverified("PHASE_F_TENANT_RUNTIME_ATTESTATION is absent or does not match the CI-verified release attestation"),
    };

    const report = await evaluateClinicReadiness(
      { organizationId, clinicId },
      configuration,
      staffProvisioning.map((row) => ({
        organizationId: row.organizationId,
        clinicId: row.clinicId,
        staffId: row.staffId,
        roleCodes: row.roleCodes,
      })),
      membership?.staffId || null,
      evidence,
    );

    return NextResponse.json({ ok: true, isReady: report.overallStatus === "READY_FOR_ACTIVATION", phase: "F_ONBOARDING_PORTABILITY", report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VALIDATION_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
