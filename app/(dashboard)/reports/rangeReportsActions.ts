"use server";

import { getDateRangeCollection, getDateRangeBusinessPosition } from "@/lib/calculations";
import type { Scope } from "@/lib/types";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { actionsForRoles } from "@/lib/webos/access";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertValidRange(startDate: string, endDate: string): void {
  if (!validIsoDate(startDate) || !validIsoDate(endDate) || startDate > endDate) {
    throw new Error("INVALID_DATE_RANGE");
  }
}

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

  assertValidRange(startDate, endDate);
  const scope = resolveAuthorizedScope(context, requestedScope);

  const [collection, businessPos] = await Promise.all([
    getDateRangeCollection(startDate, endDate, scope),
    getDateRangeBusinessPosition(startDate, endDate, scope),
  ]);

  return { collection, businessPos, scope };
}
