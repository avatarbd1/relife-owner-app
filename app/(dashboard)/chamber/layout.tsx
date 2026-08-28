import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

/**
 * Commercial boundary for the Live Chamber workspace. The page still performs
 * its normal role/department checks; this layout adds the tenant entitlement +
 * clinic feature state gate so direct URL access cannot bypass navigation.
 */
export default async function ChamberLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requireCurrentTenantAccessContext();
  await requireTenantFeature(tenant, "optional.live_chamber");
  return children;
}
