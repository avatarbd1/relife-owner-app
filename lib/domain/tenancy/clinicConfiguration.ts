// Intentionally not marked "server-only", unlike the tenancy modules that reach
// data sources. Everything here is pure, dependency-free predicate logic with no
// credentials and no I/O, and keeping it importable is what lets the isolation
// rules below be proven by executing them rather than by matching source text.

import { requireTenantScope, type TenantScope } from "./policy.ts";

/**
 * Phase A canonical clinic configuration contract.
 *
 * Mirrors the schema created by
 * `supabase/migrations/20260827130000_phase_a_clinic_configuration_foundation.sql`
 * and implements the resolution rules in
 * `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md` sections 7, 8 and 15.
 *
 * Everything here is pure and synchronous. Reads and writes stay in the existing
 * canonical data layer; this module only decides what a resolved tenant is
 * allowed to see and use, so the decision can be tested deterministically
 * instead of being re-derived at each call site.
 */

export type ClinicLifecycle =
  | "draft"
  | "setup"
  | "ready"
  | "active"
  | "suspended"
  | "archived";

/** Clinic lifecycle states that may serve production traffic. */
const SERVING_LIFECYCLE: ReadonlySet<ClinicLifecycle> = new Set(["active"]);

export type ResourceType =
  | "BED"
  | "DENTAL_CHAIR"
  | "TREATMENT_TABLE"
  | "CABIN"
  | "ROOM"
  | "MACHINE"
  | "OTHER";

export type BookingMode = "simple" | "capacity" | "specific_resource";

export interface ClinicResource extends TenantScope {
  resourceCode: string;
  displayName: string;
  resourceType: ResourceType;
  roomCode: string | null;
  capacity: number;
  genderRestriction: "Male" | "Female" | null;
  isBookable: boolean;
  isRuntimeOnly: boolean;
  isActive: boolean;
}

/**
 * A row of the global feature catalog.
 *
 * The catalog carries no tenant columns: it describes the product surface, not
 * one clinic's configuration. A retired entry withdraws the capability from
 * every clinic at once, whatever their flags and grants say.
 */
export interface FeatureCatalogEntry {
  featureKey: string;
  status: "active" | "retired";
}

export interface ClinicFeatureFlag extends TenantScope {
  featureKey: string;
  enabled: boolean;
}

export interface ClinicEntitlement extends TenantScope {
  featureKey: string;
  status: "active" | "suspended" | "revoked";
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

export interface ClinicBookingConfig extends TenantScope {
  bookingMode: BookingMode;
  defaultDurationMin: number;
  slotIntervalMin: number;
  maxSimultaneous: number | null;
  providerRequired: boolean;
  resourceRequired: boolean;
}

/**
 * A tenant-qualified key for a clinic-local business identifier.
 *
 * Clinic-local codes such as `BED-1`, `ROOM-1` or `PT0109` are deliberately
 * reusable across clinics, so any in-memory map, cache key or lookup keyed on
 * the bare local id would collide between tenants. Composing the tenant into
 * the key is what makes that overlap safe.
 */
export function tenantKey(scope: TenantScope, localId: string): string {
  const { organizationId, clinicId } = requireTenantScope(scope);
  const id = localId.trim();
  if (!id) throw new Error("TENANT_LOCAL_ID_REQUIRED");
  return `${organizationId}:${clinicId}:${id}`;
}

/**
 * True only when the row belongs to exactly the requested tenant.
 *
 * Both keys must match. A row carrying the right clinic under a different
 * organization is not owned, which is what makes clinic-local id reuse safe.
 */
export function isTenantOwned(scope: TenantScope, row: Partial<TenantScope>): boolean {
  let requested: TenantScope;
  try {
    requested = requireTenantScope(scope);
  } catch {
    return false;
  }
  const organizationId = row.organizationId?.trim();
  const clinicId = row.clinicId?.trim();
  if (!organizationId || !clinicId) return false;
  return (
    organizationId === requested.organizationId && clinicId === requested.clinicId
  );
}

/** Fail-closed guard for a single tenant-owned read or mutation. */
export function assertTenantOwned(
  scope: TenantScope,
  row: Partial<TenantScope>,
  operation: string
): void {
  if (!isTenantOwned(scope, row)) {
    throw new Error(`TENANT_SCOPE_DENIED:${operation}`);
  }
}

/**
 * Narrow a collection to rows the requested tenant owns.
 *
 * Used instead of trusting that a caller already filtered: a reader that
 * forgets its `where` clause still cannot leak another clinic's rows through
 * this helper.
 */
export function scopeToTenant<T extends Partial<TenantScope>>(
  scope: TenantScope,
  rows: readonly T[]
): T[] {
  return rows.filter((row) => isTenantOwned(scope, row));
}

/**
 * Whether a clinic in this lifecycle state may serve production traffic.
 *
 * Anything other than `active` fails closed, so a draft or suspended clinic
 * cannot be operated by omission.
 */
export function clinicMayServe(lifecycle: string | null | undefined): boolean {
  const value = (lifecycle || "").trim() as ClinicLifecycle;
  return SERVING_LIFECYCLE.has(value);
}

/**
 * Resolve whether a clinic may use a feature.
 *
 * Deliberately mirrors `relife.clinic_feature_enabled` so the SQL and the
 * application cannot drift into disagreeing. Access requires both the product
 * capability (flag) and a valid commercial grant (entitlement); every unknown
 * resolves to false.
 *
 * There is no implicit default-on and no Relife-shaped fallback: a clinic with
 * no configuration gets no features.
 */
export function resolveFeature(
  scope: TenantScope,
  featureKey: string,
  config: {
    catalog: readonly FeatureCatalogEntry[];
    flags: readonly ClinicFeatureFlag[];
    entitlements: readonly ClinicEntitlement[];
  },
  at: Date = new Date()
): boolean {
  let requested: TenantScope;
  try {
    requested = requireTenantScope(scope);
  } catch {
    return false;
  }

  const key = featureKey.trim();
  if (!key) return false;

  // The SQL resolver joins feature_catalog and requires status = 'active'.
  // Checking it here too is what keeps the two from disagreeing: without it a
  // retired capability would stay open on the application path only.
  const catalogEntry = config.catalog.find((item) => item.featureKey === key);
  if (catalogEntry?.status !== "active") return false;

  const flag = scopeToTenant(requested, config.flags).find(
    (item) => item.featureKey === key
  );
  if (!flag?.enabled) return false;

  const grant = scopeToTenant(requested, config.entitlements).find(
    (item) => item.featureKey === key && item.status === "active"
  );
  if (!grant) return false;

  if (grant.effectiveFrom.getTime() > at.getTime()) return false;
  if (grant.effectiveUntil && grant.effectiveUntil.getTime() <= at.getTime()) {
    return false;
  }

  return true;
}

/**
 * Validate a clinic's booking configuration.
 *
 * Mirrors `clinic_booking_config_mode_check`. Returns the reasons a
 * configuration is unusable so readiness can report them rather than silently
 * falling back to another clinic's shape.
 */
export function validateBookingConfig(
  config: ClinicBookingConfig
): { valid: boolean; problems: string[] } {
  const problems: string[] = [];

  if (config.defaultDurationMin <= 0) {
    problems.push("defaultDurationMin must be positive");
  }
  if (config.slotIntervalMin <= 0) {
    problems.push("slotIntervalMin must be positive");
  }
  if (config.bookingMode === "capacity" && config.maxSimultaneous === null) {
    problems.push("capacity mode requires maxSimultaneous");
  }
  if (config.bookingMode === "specific_resource" && !config.resourceRequired) {
    problems.push("specific_resource mode requires resourceRequired");
  }
  if (config.maxSimultaneous !== null && config.maxSimultaneous <= 0) {
    problems.push("maxSimultaneous must be positive when set");
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Simultaneous booking capacity for a clinic, derived from its own data.
 *
 * A clinic with no bookable resources is not a misconfiguration: in `simple`
 * mode capacity is unbounded by resources and governed by provider
 * availability instead, so this returns null rather than zero.
 *
 * Nothing here assumes a room count, a bed count, or a gender policy. Those are
 * per-clinic rows, never product constants.
 */
export function bookableCapacity(
  scope: TenantScope,
  config: ClinicBookingConfig,
  resources: readonly ClinicResource[]
): number | null {
  // The configuration itself is tenant-owned data, so it is checked before it
  // is read. Filtering only the resource rows would still let another clinic's
  // booking mode and ceiling drive this clinic's calculation.
  assertTenantOwned(scope, config, "booking.capacity");

  if (config.bookingMode === "simple") return null;

  if (config.bookingMode === "capacity") {
    return config.maxSimultaneous;
  }

  return scopeToTenant(scope, resources)
    .filter((item) => item.isActive && item.isBookable && !item.isRuntimeOnly)
    .reduce((total, item) => total + item.capacity, 0);
}
