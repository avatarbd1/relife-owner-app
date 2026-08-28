import { redirect } from "next/navigation";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isRelifeLegacyTenant } from "@/lib/config/relifeSystem";

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  const tenantContext = await requireCurrentTenantAccessContext();
  const context = tenantContext.access;
  if (!isRelifeLegacyTenant(tenantContext.tenant)) redirect("/more");
  const hasPhysioAccess =
    context.departmentAccess.includes("Physio") ||
    context.departmentAccess.includes("All");

  if (!hasPhysioAccess) redirect("/home");
  return children;
}
