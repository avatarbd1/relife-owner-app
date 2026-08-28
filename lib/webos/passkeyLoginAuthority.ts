import "server-only";

import { isPlatformOwnerStaffId } from "@/lib/domain/platform/authority";
import {
  resolveStaffTenantContext,
  type StaffTenantContext,
} from "@/lib/domain/tenancy/staffTenantContext";
import { toAccessContext } from "@/lib/webos/staffDirectory";
import { getTenantScopedWebStaffIdentity } from "@/lib/webos/tenantStaffDirectory";

export type PasskeyLoginAuthority = {
  staffId: string;
  platformOwner: boolean;
  tenant: StaffTenantContext | null;
};

/**
 * Authorize a staff id recovered from a cryptographically verified passkey.
 *
 * Clinic staff must still resolve through an active canonical tenant binding
 * and the exact tenant-scoped identity path. Platform Owner remains outside
 * clinic tenancy and is accepted only from the configured authority list.
 */
export async function requirePasskeyLoginAuthority(
  rawStaffId: string,
): Promise<PasskeyLoginAuthority> {
  const staffId = rawStaffId.trim();
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(staffId)) {
    throw new Error("INVALID_STAFF_ID");
  }

  if (
    isPlatformOwnerStaffId(
      staffId,
      String(process.env.PLATFORM_OWNER_STAFF_IDS || "").trim(),
    )
  ) {
    return { staffId, platformOwner: true, tenant: null };
  }

  const tenant = await resolveStaffTenantContext(staffId);
  const identity = await getTenantScopedWebStaffIdentity(staffId, tenant);
  if (!identity || !toAccessContext(identity)) {
    throw new Error("ACCESS_DENIED");
  }

  return { staffId, platformOwner: false, tenant };
}
