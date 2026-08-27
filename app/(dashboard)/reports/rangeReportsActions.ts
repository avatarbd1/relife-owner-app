"use server";

import { getDateRangeCollection, getDateRangeBusinessPosition } from "@/lib/calculations";
import { assertValidDateRange } from "@/lib/domain/finance/dateRange";
import type { Scope } from "@/lib/types";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { actionsForRoles } from "@/lib/webos/access";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

export async function fetchRangeReportsData(
  startDate: string,
  endDate: string,
  requestedScope: Scope
) {
  const context = await requireCurrentAccessContext();
  const actions = new Set(actionsForRoles(context.roles));

  if (!actions.has("report.read_financial")) {
    throw new Error("ACCESS_DENIED");
  }

  assertValidDateRange(startDate, endDate);
  const scope = resolveAuthorizedScope(context, requestedScope);

  const [collection, businessPos] = await Promise.all([
    getDateRangeCollection(startDate, endDate, scope),
    getDateRangeBusinessPosition(startDate, endDate, scope),
  ]);

  return { collection, businessPos, scope };
}
