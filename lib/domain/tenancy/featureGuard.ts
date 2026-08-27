import "server-only";

import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { featureDecision, type ConfigurationFailure } from "./configurationCore";
import type { TenantScope } from "./policy";

export class FeatureAccessError extends Error {
  constructor(public readonly reason: ConfigurationFailure, public readonly featureKey: string) {
    super(`FEATURE_ACCESS_DENIED:${reason}:${featureKey}`);
  }
}

async function tenantFeatureDecision(scope: TenantScope, featureKey: string) {
  return featureDecision(await readClinicConfiguration(scope), featureKey);
}

/**
 * Server-authoritative feature decision for UI composition. This deliberately
 * reuses the same canonical configuration snapshot + featureDecision path as
 * requireTenantFeature so navigation cannot drift from route/API enforcement.
 */
export async function hasTenantFeature(scope: TenantScope, featureKey: string): Promise<boolean> {
  return (await tenantFeatureDecision(scope, featureKey)).ok;
}

/** Server-authoritative feature gate. Membership/permissions are checked by the caller separately. */
export async function requireTenantFeature(scope: TenantScope, featureKey: string): Promise<void> {
  const decision = await tenantFeatureDecision(scope, featureKey);
  if (!decision.ok) throw new FeatureAccessError(decision.reason, featureKey);
}
