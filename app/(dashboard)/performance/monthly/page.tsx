import { PageHeading } from "@/components/WorkspaceUI";
import { getMonthlyGamificationFinalization } from "@/lib/data/supabaseWeeklyGamification";
import { assertCanPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { MonthlyFinalizationClient } from "./MonthlyFinalizationClient";

export default async function MonthlyGamificationPage() {
  const tenantContext = await requireCurrentTenantAccessContext();
  const context = tenantContext.access;
  assertCanPerform(context, "performance.weekly.finalize", "All");
  let finalization = null;
  try {
    finalization = await getMonthlyGamificationFinalization(
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId
    );
  } catch (error) {
    console.error("Monthly Gamification finalization unavailable", error);
  }
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading title="Monthly Reward Credits" subtitle="Published roster + complete verified role scores + fixed budget" />
      <MonthlyFinalizationClient initialFinalization={finalization} />
    </div>
  );
}
