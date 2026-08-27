import { NextRequest, NextResponse } from "next/server";
import { validateDepartmentAccess, validateTenantScope } from "@/lib/domain/tenancy/validators";
import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { adjustPhysioInventory } from "@/lib/webos/inventory";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    // T2-02: Require full tenant-aware context for tool operations
    const tenantContext = await requireCurrentTenantAccessContext();
    const { access, tenant } = tenantContext;
    validateDepartmentAccess(access, "Physio");
    validateTenantScope(access, tenant, "inventory.adjust");
    await requireTenantFeature(tenant, "optional.inventory");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const result = await adjustPhysioInventory(access, tenant.organizationId, tenant.clinicId, {
      itemName: body.itemName,
      change: Number(body.change),
      reason: body.reason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INVENTORY_UPDATE_FAILED";
    const status = message === "ACCESS_DENIED" || message.startsWith("FEATURE_ACCESS_DENIED:") ? 403 : message.includes("SCHEMA") ? 503 : 400;
    if (status >= 500) console.error("Inventory update failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
