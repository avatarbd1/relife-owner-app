import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration, writeClinicProfile, writeOperatingHours } from "@/lib/data/clinicConfiguration";
import { isValidTimezone, validateOperatingHours, type ClinicProfileConfiguration, type OperatingHourConfiguration } from "@/lib/domain/tenancy/configurationCore";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "CONFIGURATION_FAILED";
  const status = /ACCESS|AUTHORIZED|TENANT_SCOPE/.test(message) ? 403 : /INVALID|REQUIRED/.test(message) ? 400 : /UNAVAILABLE/.test(message) ? 503 : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

function authorized(context: Awaited<ReturnType<typeof requireCurrentTenantAccessContext>>) {
  validateTenantScope(context.access, context.tenant, "clinic.manage");
  if (!canPerform(context.access, "settings.manage", "Physio") && !canPerform(context.access, "settings.manage", "Dental")) throw new Error("CONFIGURATION_NOT_AUTHORIZED");
}

export async function GET() {
  try {
    const context = await requireCurrentTenantAccessContext();
    validateTenantScope(context.access, context.tenant, "clinic.read");
    const configuration = await readClinicConfiguration(context.tenant);
    return NextResponse.json({ ok: true, configuration });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentTenantAccessContext(); authorized(context);
    const body = await request.json() as { profile?: Partial<ClinicProfileConfiguration>; operatingHours?: OperatingHourConfiguration[] };
    if (body.profile) {
      const p = body.profile;
      if (!String(p.clinicName || "").trim() || !isValidTimezone(String(p.timezone || ""))) throw new Error("INVALID_CLINIC_PROFILE");
      await writeClinicProfile(context.tenant, {
        clinicName: String(p.clinicName).trim(), clinicType: p.clinicType || "other", branchName: String(p.branchName || "").trim(), address: String(p.address || "").trim(), phone: String(p.phone || "").trim(), email: String(p.email || "").trim(), logoUrl: String(p.logoUrl || "").trim(), currency: String(p.currency || "BDT").trim(), locale: String(p.locale || "en").trim(), timezone: String(p.timezone).trim(),
      }, context.access.staffId);
    }
    if (body.operatingHours) {
      const rows = body.operatingHours.map((r) => ({ ...r, organizationId: context.tenant.organizationId, clinicId: context.tenant.clinicId }));
      if (validateOperatingHours(rows).length) throw new Error("INVALID_OPERATING_HOURS");
      await writeOperatingHours(context.tenant, rows);
    }
    return NextResponse.json({ ok: true, configuration: await readClinicConfiguration(context.tenant) });
  } catch (error) { return fail(error); }
}
