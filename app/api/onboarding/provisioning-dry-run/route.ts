import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { buildProvisioningDryRun } from "@/lib/domain/tenancy/provisioningPlan";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

export async function GET(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const { access, tenant } = await requireCurrentTenantAccessContext();
    validateTenantScope(access, tenant, "clinic.manage");
    if (!canPerform(access, "settings.manage", "Physio") && !canPerform(access, "settings.manage", "Dental")) {
      return NextResponse.json({ ok: false, error: "ACCESS_DENIED" }, { status: 403 });
    }

    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) return NextResponse.json({ ok: false, error: "CONFIGURATION_STORE_UNAVAILABLE" }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const configuration = await readClinicConfiguration({ organizationId: tenant.organizationId, clinicId: tenant.clinicId }, client);
    const dryRun = buildProvisioningDryRun({ organizationId: tenant.organizationId, clinicId: tenant.clinicId }, configuration);
    return NextResponse.json({ ok: true, dryRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PROVISIONING_DRY_RUN_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|TENANT_SCOPE/.test(message) ? 403 : 500 });
  }
}
