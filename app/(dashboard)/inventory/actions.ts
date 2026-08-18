"use server";

import { adjustPhysioInventory as adjustInventoryRaw } from "@/lib/webos/inventory";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

export async function adjustPhysioInventory(input: {
  itemName: string;
  change: number;
  reason: string;
}) {
  const context = await requireCurrentAccessContext();
  return adjustInventoryRaw(context, input);
}
