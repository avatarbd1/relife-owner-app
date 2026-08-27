import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { configurationReadiness } from "@/lib/domain/tenancy/configurationCore";
import { loadStaffMembership } from "@/lib/domain/tenancy/staffAuthorization";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    validateTenantScope(access, tenant, "clinic.manage");
    if (!canPerform(access, "settings.manage", "Physio") && !canPerform(access, "settings.manage", "Dental")) return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { organizationId?: string; clinicId?: string };
    const organizationId = String(body.organizationId || tenant.organizationId).trim();
    const clinicId = String(body.clinicId || tenant.clinicId).trim();
    if (organizationId !== tenant.organizationId || clinicId !== tenant.clinicId) return NextResponse.json({ ok: false, error: "TENANT_SCOPE_MISMATCH" }, { status: 403 });
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(); const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) return NextResponse.json({ ok: false, error: "CONFIGURATION_STORE_UNAVAILABLE" }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const relife = client.schema("relife");
    const [{ data: organization }, { data: clinic }, membership, configuration] = await Promise.all([
      relife.from("organizations").select("id").eq("id", organizationId).maybeSingle(),
      relife.from("clinics").select("id,organization_id,status").eq("organization_id", organizationId).eq("id", clinicId).maybeSingle(),
      loadStaffMembership(client, { organizationId, clinicId }, access.staffId),
      readClinicConfiguration({ organizationId, clinicId }, client),
    ]);
    const authorizedMembership = Boolean(membership && membership.organizationId === organizationId && membership.clinicId === clinicId);
    const phaseB = configurationReadiness(configuration, authorizedMembership);
    const checks = {
      tenantContextResolvable: true,
      organizationExists: Boolean(organization), clinicExists: Boolean(clinic),
      clinicBelongsToOrganization: Boolean(clinic && clinic.organization_id === organizationId),
      staffHasClinicMembership: authorizedMembership,
      validLifecycle: configuration.profile?.lifecycle === "active",
      clinicProfileConfigured: Boolean(configuration.profile), operatingHoursConfigured: configuration.operatingHours.length === 7,
      featureConfigurationConsistent: !phaseB.reasons.some((reason) => reason.startsWith("feature ")),
      requiredServicesConfigured: !phaseB.reasons.includes("enabled services workflow requires an active service"),
      tenantSafeConfigurationLookup: configuration.scope.organizationId === organizationId && configuration.scope.clinicId === clinicId && configuration.operatingHours.every((row) => row.organizationId === organizationId && row.clinicId === clinicId) && configuration.services.every((row) => row.organizationId === organizationId && row.clinicId === clinicId),
    };
    const errors = [...phaseB.reasons];
    if (!checks.organizationExists) errors.unshift("organization not found"); if (!checks.clinicExists) errors.unshift("clinic not found in organization");
    return NextResponse.json({ ok: true, isReady: Object.values(checks).every(Boolean) && errors.length === 0, phase: "B_CONFIGURATION_CORE", checks, errors, warnings: ["This validates the Phase B configuration slice only; facility/booking runtime, finance, imports and full activation remain deferred."] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VALIDATION_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
