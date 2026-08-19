import { PageHeading } from "@/components/WorkspaceUI";
import { getWeeklyGamificationFinalization } from "@/lib/data/supabaseWeeklyGamification";
import { assertCanPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { WeeklyFinalizationClient } from "./WeeklyFinalizationClient";

export default async function WeeklyGamificationPage() {
  const context = await requireCurrentAccessContext();
  assertCanPerform(context, "performance.weekly.finalize", "All");

  let finalization = null;
  try {
    finalization = await getWeeklyGamificationFinalization();
  } catch (error) {
    console.error("Weekly Gamification finalization unavailable", error);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        title="Weekly Gamification"
        subtitle="Owner finalization recovery, verified score coverage and Reward Credit earning"
      />
      <WeeklyFinalizationClient initialFinalization={finalization} />
    </div>
  );
}
