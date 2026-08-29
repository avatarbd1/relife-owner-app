"use server";

import { isRelifeLegacyTenant } from "@/lib/config/relifeSystem";
import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { adjustPhysioInventory as adjustInventoryRaw } from "@/lib/webos/inventory";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export async function adjustPhysioInventory(input: {
  itemName: string;
  change: number;
  reason: string;
}) {
  const { access, tenant } = await requireCurrentTenantAccessContext();
  await requireTenantFeature(tenant, "optional.inventory");
  if (!isRelifeLegacyTenant(tenant)) throw new Error("LEGACY_INVENTORY_NOT_AVAILABLE");
  return adjustInventoryRaw(access, tenant.organizationId, tenant.clinicId, input);
}
