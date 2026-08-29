/**
 * Which store owns a clinic's operational record.
 *
 * The platform is mid-migration: Relife's patients, appointments and payments
 * live in its legacy Google Sheets workbooks, while a newly provisioned clinic
 * has no Sheets workbook at all and uses the tenant-native Supabase core.
 *
 * The rule that keeps this from becoming a dual-writer is that a clinic has
 * exactly one operational authority. This module is the only place that
 * decision is made, and it is deliberately pure so the routing can be tested
 * without a database.
 */

export type OperationalStore = "sheets" | "supabase";

/** The stores a clinic may legitimately be routed to. */
export const OPERATIONAL_STORES: readonly OperationalStore[] = ["sheets", "supabase"] as const;

export function isOperationalStore(value: unknown): value is OperationalStore {
  return typeof value === "string" && (OPERATIONAL_STORES as readonly string[]).includes(value);
}

/**
 * Resolve the authoritative operational store for a clinic.
 *
 * Fails closed. An unconfigured clinic, an unknown store value, or a clinic
 * whose profile could not be read is an error rather than a silent fallback:
 * guessing here would either strand a new clinic's writes in a workbook it does
 * not own, or point Relife's live traffic at an empty table.
 */
export function resolveOperationalStore(value: unknown): OperationalStore {
  if (!isOperationalStore(value)) throw new Error("OPERATIONAL_STORE_NOT_CONFIGURED");
  return value;
}

/**
 * Whether a clinic's operational record is served by the tenant-native core.
 * Callers that still have a Sheets path use this to pick the adapter; they must
 * not branch on the clinic's slug, name or department.
 */
export function usesTenantNativeOperationalCore(value: unknown): boolean {
  return resolveOperationalStore(value) === "supabase";
}
