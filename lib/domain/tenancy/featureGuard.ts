import "server-only";

import { readClinicConfiguration } from "@/lib/data/clinicConfiguration";
import { featureDecision, type ConfigurationFailure } from "./configurationCore";
import type { TenantScope } from "./policy";

export class FeatureAccessError extends Error {
  constructor(public readonly reason: ConfigurationFailure, public readonly featureKey: string) {
    super(`FEATURE_ACCESS_DENIED:${reason}:${featureKey}`);
  }
}

/** Server-authoritative feature gate. Membership/permissions are checked by the caller separately. */
export async function requireTenantFeature(scope: TenantScope, featureKey: string): Promise<void> {
  const decision = featureDecision(await readClinicConfiguration(scope), featureKey);
  if (!decision.ok) throw new FeatureAccessError(decision.reason, featureKey);
}
