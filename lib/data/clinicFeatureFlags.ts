import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";

function adminClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("CONFIGURATION_STORE_UNAVAILABLE");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function entitlementIsEffective(row: Record<string, unknown> | null, now = new Date()): boolean {
  if (!row || String(row.status || "") !== "active") return false;
  const starts = new Date(String(row.effective_from || ""));
  if (Number.isNaN(starts.getTime()) || starts.getTime() > now.getTime()) return false;
  if (!row.effective_until) return true;
  const ends = new Date(String(row.effective_until));
  return !Number.isNaN(ends.getTime()) && ends.getTime() >= now.getTime();
}

export async function writeClinicFeatureFlag(
  scope: TenantScope,
  featureKey: string,
  enabled: boolean,
  client = adminClient(),
) {
  const tenant = requireTenantScope(scope);
  const key = featureKey.trim();
  if (!key) throw new Error("FEATURE_KEY_REQUIRED");

  const relife = client.schema("relife");
  const [catalogResult, entitlementResult] = await Promise.all([
    relife.from("feature_catalog").select("feature_key,status").eq("feature_key", key).maybeSingle(),
    relife.from("clinic_entitlements")
      .select("feature_key,status,effective_from,effective_until")
      .eq("organization_id", tenant.organizationId)
      .eq("clinic_id", tenant.clinicId)
      .eq("feature_key", key)
      .maybeSingle(),
  ]);

  if (catalogResult.error) throw new Error(`CONFIGURATION_FEATURE_CATALOG_READ_FAILED:${catalogResult.error.message}`);
  if (entitlementResult.error) throw new Error(`CONFIGURATION_ENTITLEMENT_READ_FAILED:${entitlementResult.error.message}`);
  if (!catalogResult.data) throw new Error("FEATURE_NOT_AVAILABLE");
  if (enabled && String(catalogResult.data.status) !== "active") throw new Error("FEATURE_NOT_AVAILABLE");
  if (enabled && !entitlementIsEffective(entitlementResult.data as Record<string, unknown> | null)) {
    throw new Error("FEATURE_NOT_ENTITLED");
  }

  const result = await relife.from("clinic_feature_flags").upsert({
    organization_id: tenant.organizationId,
    clinic_id: tenant.clinicId,
    feature_key: key,
    enabled,
  }, { onConflict: "organization_id,clinic_id,feature_key" }).select("feature_key,enabled").single();

  if (result.error) throw new Error(`CONFIGURATION_FEATURE_FLAG_WRITE_FAILED:${result.error.message}`);
  return result.data;
}
