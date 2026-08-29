import { PageHeading } from "@/components/WorkspaceUI";
import { getGamificationStaffSummary } from "@/lib/data/supabaseGamification";
import { listRewardClaims, rewardClaimsConfigured } from "@/lib/data/supabaseRewardClaims";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { performanceWeekRange } from "@/lib/webos/performance";
import { getPerformanceRewardPolicy } from "@/lib/webos/performanceRewards";
import { todayDhaka } from "@/lib/webos/reception";
import { listTenantScopedWebStaffDirectory } from "@/lib/webos/tenantStaffDirectory";
import { RewardClaimsClient } from "./RewardClaimsClient";

const CLAIMANT_ROLES = new Set(["Manager", "Receptionist", "Therapist", "Dentist"]);

export default async function RewardClaimsPage() {
  const tenantContext = await requireCurrentTenantAccessContext();
  const context = tenantContext.access;
  const today = todayDhaka();
  const week = performanceWeekRange(today);
  const isOwner = context.roles.includes("Owner");
  const canRequest = context.roles.some((role) => CLAIMANT_ROLES.has(role));
  const departments = (["Physio", "Dental"] as const).filter(
    (department) =>
      context.departmentAccess.includes("All") || context.departmentAccess.includes(department)
  );

  const [rewardPolicy, directory, claimsResult, ledgerResult] = await Promise.all([
    getPerformanceRewardPolicy(tenantContext.tenant),
    listTenantScopedWebStaffDirectory(tenantContext.tenant).catch(() => []),
    rewardClaimsConfigured()
      ? listRewardClaims({
          actorId: context.staffId,
          actorRoles: context.roles,
          actorDepartmentAccess: context.departmentAccess,
          organizationId: tenantContext.tenant.organizationId,
          clinicId: tenantContext.tenant.clinicId,
          status: "all",
        }).then((claims) => ({ claims, ok: true as const })).catch((error) => {
          console.error("Reward claims unavailable", error);
          return { claims: [], ok: false as const };
        })
      : Promise.resolve({ claims: [], ok: false as const }),
    canRequest
      ? getGamificationStaffSummary(tenantContext.tenant, {
          staffId: context.staffId,
          weekStart: week.start,
          weekEnd: week.end,
          today,
        }).catch((error) => {
          console.error("Reward claim ledger unavailable", error);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const staffNames = Object.fromEntries(
    directory.map((identity) => [identity.staffId, identity.fullName || identity.staffId])
  );
  const ledgerValid = Boolean(ledgerResult?.rewardCredits.valid);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Reward Claims"
        subtitle={isOwner ? "Owner approval queue · immutable RC lifecycle" : "Request, reserve and track your rewards"}
      />
      <RewardClaimsClient
        claims={claimsResult.claims}
        rewards={rewardPolicy.catalog.map((reward) => ({
          key: reward.key,
          icon: reward.icon,
          title: reward.title,
          description: reward.description,
          kind: reward.kind,
          creditCost: reward.creditCost,
          coverageRequired: reward.coverageRequired,
          cooldownDays: reward.cooldownDays,
          maxPerMonth: reward.maxPerMonth,
          maxPerQuarter: reward.maxPerQuarter,
        }))}
        staffNames={staffNames}
        currentStaffId={context.staffId}
        isOwner={isOwner}
        canRequest={canRequest && departments.length > 0 && rewardPolicy.catalog.length > 0}
        departments={departments}
        today={today}
        availableRc={ledgerValid ? ledgerResult?.rewardCredits.availableBalance ?? 0 : null}
        reservedRc={ledgerValid ? ledgerResult?.rewardCredits.reservedBalance ?? 0 : null}
        ledgerValid={ledgerValid}
        serviceAvailable={claimsResult.ok && rewardPolicy.catalog.length > 0}
      />
    </div>
  );
}
