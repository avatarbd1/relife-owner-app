import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { listStoredStaffProvisioning } from "@/lib/data/staffProvisioning";
import { configurationReadiness, facilityBookingReadiness } from "@/lib/domain/tenancy/configurationCore";
import { staffFinanceReadiness } from "@/lib/domain/tenancy/staffFinanceConfiguration";
import { loadStaffMembership } from "@/lib/domain/tenancy/staffAuthorization";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { listManagedStaff } from "@/lib/webos/staffManagement";
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
    const [{ data: organization }, { data: clinic }, membership, configuration, staffProvisioning] = await Promise.all([
      relife.from("organizations").select("id").eq("id", organizationId).maybeSingle(),
      relife.from("clinics").select("id,organization_id,status").eq("organization_id", organizationId).eq("id", clinicId).maybeSingle(),
      loadStaffMembership(client, { organizationId, clinicId }, access.staffId),
      readClinicConfiguration({ organizationId, clinicId }, client),
      listStoredStaffProvisioning({ organizationId, clinicId }, client),
    ]);
    const authorizedMembership = Boolean(membership && membership.organizationId === organizationId && membership.clinicId === clinicId);
    const managedStaff = access.roles.includes("Owner")
      ? await listManagedStaff(access, organizationId, clinicId)
      : [];
    const salaryByStaff = new Map(managedStaff.map((row) => [row.staffId, row.salary]));
    const phaseB = configurationReadiness(configuration, authorizedMembership);
    const phaseC = facilityBookingReadiness(configuration);
    const phaseD = staffFinanceReadiness({ organizationId, clinicId }, configuration, staffProvisioning.map((row) => ({
      organizationId: row.organizationId,
      clinicId: row.clinicId,
      staffId: row.staffId,
      roleCodes: row.roleCodes,
      departmentIds: row.departmentIds,
      status: row.status,
      salaryAmount: row.roleCodes.includes("owner") ? null : (salaryByStaff.get(row.staffId) ?? null),
      appointmentProvider: false,
      loginEnabled: true,
    })));
    const checks = {
      tenantContextResolvable: true,
      organizationExists: Boolean(organization), clinicExists: Boolean(clinic),
      clinicBelongsToOrganization: Boolean(clinic && clinic.organization_id === organizationId),
      staffHasClinicMembership: authorizedMembership,
      validLifecycle: configuration.profile?.lifecycle === "active",
      clinicProfileConfigured: Boolean(configuration.profile), operatingHoursConfigured: configuration.operatingHours.length === 7,
      featureConfigurationConsistent: !phaseB.reasons.some((reason) => reason.startsWith("feature ")),
      requiredServicesConfigured: !phaseB.reasons.includes("enabled services workflow requires an active service"),
      tenantSafeConfigurationLookup: configuration.scope.organizationId === organizationId && configuration.scope.clinicId === clinicId && [...(configuration.profile ? [configuration.profile] : []), ...configuration.operatingHours, ...configuration.flags, ...configuration.entitlements, ...configuration.services].every((row) => row.organizationId === organizationId && row.clinicId === clinicId),
      bookingConfigurationValid: phaseC.readyForPhaseCScope,
      facilityRowsTenantSafe: (configuration.rooms || []).every((row) => row.organizationId === organizationId && row.clinicId === clinicId) && (configuration.resources || []).every((row) => row.organizationId === organizationId && row.clinicId === clinicId),
      staffProvisioningValid: !phaseD.reasons.some((reason) => reason.startsWith("staff ") || reason.includes("owner provisioning")),
      financeConfigurationValid: !phaseD.reasons.some((reason) => reason.startsWith("basic finance:")),
      // Phase A kept these visible and unevaluated so readiness could not become
      // true while they were unverified. No slice since — B, C or D — has
      // evaluated them either, so they stay false: dropping them from the
      // response would let isReady succeed on evidence nobody has gathered.
      departmentDataScopedToClinic: false,
      tenantFiltersPresentInReaders: false,
      explicitTenantParametersInWriters: false,
    };
    const errors = [...phaseB.reasons, ...phaseC.reasons, ...phaseD.reasons];
    if (!checks.organizationExists) errors.unshift("organization not found"); if (!checks.clinicExists) errors.unshift("clinic not found in organization");
    return NextResponse.json({ ok: true, isReady: Object.values(checks).every(Boolean) && errors.length === 0, phase: "D_STAFF_FINANCE", checks, errors, warnings: ["This validates the Phase D staff/finance slice only; owner UX, imports, onboarding and full activation remain deferred.", "Department data scoping has not been verified by this runtime validator", "Reader tenant filtering has not been verified by this runtime validator", "Writer tenant parameter coverage has not been verified by this runtime validator"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VALIDATION_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
