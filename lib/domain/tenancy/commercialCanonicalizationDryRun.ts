import { requireTenantScope, type TenantScope } from "./policy.ts";

export interface CommercialFeatureTarget {
  featureKey: string;
  enabled: boolean;
  evidenceSources: string[];
}

export interface CommercialCanonicalizationInput {
  scope: Partial<TenantScope>;
  activeCatalogKeys: string[];
  targets: CommercialFeatureTarget[];
  current: {
    flags: Array<TenantScope & { featureKey: string; enabled: boolean }>;
    entitlements: Array<TenantScope & { featureKey: string; status: "active" | "suspended" | "revoked" }>;
  };
}

export interface CommercialCanonicalizationOperation {
  table: "clinic_feature_flags" | "clinic_entitlements";
  action: "upsert" | "insert" | "no_change";
  featureKey: string;
  values: Record<string, string | boolean>;
  reason: string;
}

export interface CommercialCanonicalizationDryRun {
  dryRun: true;
  writesPerformed: false;
  deletesPlanned: false;
  verdict: "ready" | "blocked";
  scope: TenantScope | null;
  blockers: string[];
  operations: CommercialCanonicalizationOperation[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildCommercialCanonicalizationDryRun(
  input: CommercialCanonicalizationInput,
): CommercialCanonicalizationDryRun {
  let scope: TenantScope | null = null;
  const blockers: string[] = [];
  try {
    scope = requireTenantScope(input.scope);
  } catch {
    blockers.push("TENANT_SCOPE_REQUIRED");
  }

  const catalog = new Set(unique(input.activeCatalogKeys));
  const seen = new Set<string>();
  const operations: CommercialCanonicalizationOperation[] = [];
  if (input.targets.length === 0) blockers.push("FEATURE_TARGETS_REQUIRED");

  if (scope) {
    const rows = [...input.current.flags, ...input.current.entitlements];
    if (rows.some((row) => row.organizationId !== scope!.organizationId || row.clinicId !== scope!.clinicId)) {
      blockers.push("CROSS_TENANT_COMMERCIAL_STATE");
    }
  }

  for (const target of input.targets) {
    const featureKey = target.featureKey.trim();
    if (!featureKey || seen.has(featureKey)) {
      blockers.push(`FEATURE_TARGET_INVALID:${featureKey || "blank"}`);
      continue;
    }
    seen.add(featureKey);
    if (!catalog.has(featureKey)) {
      blockers.push(`FEATURE_NOT_ACTIVE:${featureKey}`);
      continue;
    }
    if (unique(target.evidenceSources).length === 0) {
      blockers.push(`FEATURE_EVIDENCE_REQUIRED:${featureKey}`);
      continue;
    }
    if (!scope) continue;

    const flag = input.current.flags.find((row) => row.featureKey === featureKey);
    operations.push({
      table: "clinic_feature_flags",
      action: flag?.enabled === target.enabled ? "no_change" : "upsert",
      featureKey,
      values: {
        organization_id: scope.organizationId,
        clinic_id: scope.clinicId,
        feature_key: featureKey,
        enabled: target.enabled,
        enabled_by: "controlled_canonicalization",
        notes: "i1-basic-pilot:2026-08-28",
      },
      reason: target.enabled ? "approved tenant feature target" : "basic pilot keeps optional module locked",
    });

    // Disabling access never deletes, revokes, or rewrites entitlement history.
    if (!target.enabled) continue;
    const activeGrant = input.current.entitlements.find(
      (row) => row.featureKey === featureKey && row.status === "active",
    );
    operations.push({
      table: "clinic_entitlements",
      action: activeGrant ? "no_change" : "insert",
      featureKey,
      values: {
        organization_id: scope.organizationId,
        clinic_id: scope.clinicId,
        feature_key: featureKey,
        status: "active",
        source: "migration",
        plan_code: "tenant-pilot",
        grant_reason: "owner-approved tenant feature target",
        granted_by: "controlled_canonicalization",
      },
      reason: activeGrant ? "matching active entitlement already exists" : "approved access needs an active grant",
    });
  }

  return {
    dryRun: true,
    writesPerformed: false,
    deletesPlanned: false,
    verdict: blockers.length === 0 ? "ready" : "blocked",
    scope,
    blockers: unique(blockers),
    operations,
  };
}
