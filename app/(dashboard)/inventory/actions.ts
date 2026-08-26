"use server";

import { adjustPhysioInventory as adjustInventoryRaw } from "@/lib/webos/inventory";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

export async function adjustPhysioInventory(input: {
  itemName: string;
  change: number;
  reason: string;
}) {
  const { access, tenant } = await requireCurrentTenantAccessContext();
  return adjustInventoryRaw(access, tenant.organizationId, tenant.clinicId, input);
}
