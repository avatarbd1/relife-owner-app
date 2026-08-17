"use server";

import { getDateRangeCollection, getDateRangeBusinessPosition } from "@/lib/calculations";
import type { Scope } from "@/lib/types";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { actionsForRoles } from "@/lib/webos/access";

export async function fetchRangeReportsData(startDate: string, endDate: string, scope: Scope) {
  const context = await requireCurrentAccessContext();
  const actions = new Set(actionsForRoles(context.roles));

  if (!actions.has("report.read_financial")) {
    throw new Error("Access denied: report.read_financial required");
  }

  const [collection, businessPos] = await Promise.all([
    getDateRangeCollection(startDate, endDate, scope),
    getDateRangeBusinessPosition(startDate, endDate, scope),
  ]);

  return { collection, businessPos };
}
