import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readClinicConfiguration, writeClinicProfile } from "@/lib/data/clinicConfiguration";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import type { ClinicType } from "@/lib/domain/platform/platformOwnerMvp";
import { requireTenantScope, type TenantScope } from "@/lib/domain/tenancy/policy";

export async function patchPlatformClinicProfile(
  scope: TenantScope,
  patch: {
    clinicName?: string;
    clinicType?: ClinicType;
    branchName?: string;
    address?: string;
    phone?: string;
    email?: string;
    logoUrl?: string;
    currency?: string;
    locale?: string;
    timezone?: string;
  },
  actorStaffId: string,
  client: SupabaseClient = createSupabaseAdminClient(),
): Promise<void> {
  const tenant = requireTenantScope(scope);
  const current = await readClinicConfiguration(tenant, client);
  const profile = current.profile;
  if (!profile) throw new Error("PLATFORM_CLINIC_PROFILE_NOT_FOUND");
  const clinicName = String(patch.clinicName || "").trim() || profile.clinicName;
  const branchName = String(patch.branchName || "").trim() || profile.branchName || clinicName;
  await writeClinicProfile(tenant, {
    clinicName,
    clinicType: patch.clinicType || profile.clinicType,
    branchName,
    address: String(patch.address || "").trim() || profile.address,
    phone: String(patch.phone || "").trim() || profile.phone,
    email: String(patch.email || "").trim() || profile.email,
    logoUrl: String(patch.logoUrl || "").trim() || profile.logoUrl,
    currency: String(patch.currency || "").trim() || profile.currency || "BDT",
    locale: String(patch.locale || "").trim() || profile.locale || "en",
    timezone: String(patch.timezone || "").trim() || profile.timezone || "Asia/Dhaka",
  }, `platform:${actorStaffId}`, client);
}
