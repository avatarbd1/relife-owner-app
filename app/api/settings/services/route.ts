import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration, writeClinicService } from "@/lib/data/clinicConfiguration";
import type { ClinicServiceConfiguration } from "@/lib/domain/tenancy/configurationCore";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

function fail(error: unknown) { const message = error instanceof Error ? error.message : "SERVICE_CONFIGURATION_FAILED"; return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|AUTHORIZED|TENANT_SCOPE/.test(message) ? 403 : /INVALID|REQUIRED/.test(message) ? 400 : 500 }); }

export async function GET() {
  try { const { access, tenant } = await requireCurrentTenantAccessContext(); validateTenantScope(access, tenant, "clinic.read"); return NextResponse.json({ ok: true, services: (await readClinicConfiguration(tenant)).services }); } catch (error) { return fail(error); }
}

export async function PUT(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext(); validateTenantScope(access, tenant, "clinic.manage");
    if (!canPerform(access, "settings.manage", "Physio") && !canPerform(access, "settings.manage", "Dental")) throw new Error("CONFIGURATION_NOT_AUTHORIZED");
    const input = await request.json() as Partial<ClinicServiceConfiguration>;
    const serviceCode = String(input.serviceCode || "").trim(); const displayName = String(input.displayName || "").trim();
    const price = Number(input.price); const durationMin = Number(input.durationMin);
    if (!serviceCode || !displayName || !Number.isFinite(price) || price < 0 || !Number.isInteger(durationMin) || durationMin <= 0) throw new Error("INVALID_SERVICE_CONFIGURATION");
    // The platform offers exactly one clinic template (Physiotherapy). No
    // clinic may add a new or re-enabled Dental-department service.
    if (input.department === "Dental") throw new Error("INVALID_SERVICE_DEPARTMENT");
    await writeClinicService(tenant, { serviceCode, displayName, department: input.department || "All", price, durationMin, requiresBooking: input.requiresBooking !== false, requiresProvider: input.requiresProvider !== false, requiresResource: input.requiresResource === true, discountApplicable: input.discountApplicable !== false, taxApplicable: input.taxApplicable === true, packageEligible: input.packageEligible === true, isActive: input.isActive !== false });
    return NextResponse.json({ ok: true, services: (await readClinicConfiguration(tenant)).services });
  } catch (error) { return fail(error); }
}
