import { requireTenantFeature } from "@/lib/domain/tenancy/featureGuard";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";

/** Salary/advance is exposed only inside the Advanced Finance commercial bundle. */
export default async function SalaryLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requireCurrentTenantAccessContext();
  await requireTenantFeature(tenant, "optional.finance_advanced");
  await requireTenantFeature(tenant, "optional.salary");
  return children;
}
