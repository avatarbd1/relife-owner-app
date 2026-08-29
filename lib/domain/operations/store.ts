import "server-only";

import { readOperationalStore } from "@/lib/data/clinicConfiguration";
import type { TenantScope } from "@/lib/domain/tenancy/policy";
import { requireTenantScope } from "@/lib/domain/tenancy/policy";
import {
  resolveOperationalStore,
  type OperationalStore,
} from "@/lib/domain/tenancy/operationalStore";

/**
 * The single routing decision for tenant-owned operational data.
 *
 * Every patient, appointment and payment path asks this one question — which
 * store owns this clinic's record — and then uses exactly one adapter. That is
 * what keeps the tenant-native core from becoming a second writer beside
 * Sheets: not discipline at each call site, but a single decision that both
 * sides are checked against.
 *
 * The tenant argument must come from the resolved server session. A store or
 * tenant supplied by the browser is never accepted here, because choosing your
 * own store would be choosing your own data.
 */
export async function resolveTenantOperationalStore(
  scope: TenantScope,
): Promise<OperationalStore> {
  const tenant = requireTenantScope(scope);
  // `resolveOperationalStore` throws OPERATIONAL_STORE_NOT_CONFIGURED on a
  // missing or unrecognised value, so an unconfigured clinic stops here rather
  // than being quietly routed somewhere plausible.
  return resolveOperationalStore(await readOperationalStore(tenant));
}

/**
 * Guard for a path that only one store may serve.
 *
 * Both directions matter. A Sheets-authoritative clinic must never write into
 * the new operational tables, or its record silently splits across two stores.
 * A Supabase-authoritative clinic must never fall back to Sheets, where it has
 * no workbook and would read another clinic's ledger or nothing at all.
 */
export async function assertOperationalStore(
  scope: TenantScope,
  expected: OperationalStore,
): Promise<void> {
  const actual = await resolveTenantOperationalStore(scope);
  if (actual !== expected) throw new Error(`OPERATIONAL_STORE_MISMATCH:${expected}`);
}

/** Whether this clinic's operational record is served by the tenant-native core. */
export async function isTenantNativeClinic(scope: TenantScope): Promise<boolean> {
  return (await resolveTenantOperationalStore(scope)) === "supabase";
}
