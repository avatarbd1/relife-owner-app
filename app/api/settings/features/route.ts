import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { writeClinicFeatureFlag } from "@/lib/data/clinicFeatureFlags";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "FEATURE_CONFIGURATION_FAILED";
  const status = /ACCESS|AUTHORIZED|TENANT_SCOPE|NOT_ENTITLED/.test(message)
    ? 403
    : /INVALID|REQUIRED|NOT_AVAILABLE/.test(message)
      ? 400
      : /UNAVAILABLE/.test(message)
        ? 503
        : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

function authorize(context: Awaited<ReturnType<typeof requireCurrentTenantAccessContext>>) {
  validateTenantScope(context.access, context.tenant, "clinic.manage");
  if (!canPerform(context.access, "settings.manage", "Physio") && !canPerform(context.access, "settings.manage", "Dental")) {
    throw new Error("CONFIGURATION_NOT_AUTHORIZED");
  }
}

function featureRows(configuration: Awaited<ReturnType<typeof readClinicConfiguration>>) {
  const flagMap = new Map(configuration.flags.map((row) => [row.featureKey, row.enabled]));
  const entitlementMap = new Map(configuration.entitlements.map((row) => [row.featureKey, row]));
  const now = Date.now();
  return configuration.catalog
    .filter((feature) => feature.status === "active")
    .map((feature) => {
      const entitlement = entitlementMap.get(feature.featureKey);
      const entitled = Boolean(
        entitlement
        && entitlement.status === "active"
        && entitlement.effectiveFrom.getTime() <= now
        && (entitlement.effectiveUntil === null || entitlement.effectiveUntil.getTime() >= now),
      );
      return {
        featureKey: feature.featureKey,
        enabled: flagMap.get(feature.featureKey) === true,
        entitled,
      };
    });
}

export async function GET() {
  try {
    const context = await requireCurrentTenantAccessContext();
    validateTenantScope(context.access, context.tenant, "clinic.read");
    return NextResponse.json({ ok: true, features: featureRows(await readClinicConfiguration(context.tenant)) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const context = await requireCurrentTenantAccessContext();
    authorize(context);
    const body = await request.json().catch(() => ({})) as { featureKey?: string; enabled?: boolean };
    const featureKey = String(body.featureKey || "").trim();
    if (!featureKey || typeof body.enabled !== "boolean") throw new Error("INVALID_FEATURE_CONFIGURATION");
    await writeClinicFeatureFlag(context.tenant, featureKey, body.enabled);
    return NextResponse.json({ ok: true, features: featureRows(await readClinicConfiguration(context.tenant)) });
  } catch (error) {
    return fail(error);
  }
}
