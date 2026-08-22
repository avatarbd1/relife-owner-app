import WorkforceClient from "@/components/WorkforceClient";
import { PageHeading } from "@/components/WorkspaceUI";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { listLeaveForContext } from "@/lib/domain/workforce/leave";
import { listShiftsForContext } from "@/lib/domain/workforce/shifts";
import { isWorkforceManagerTier } from "@/lib/domain/workforce/workforceScope";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

type ReadState<T> = { data: T; error: "schema" | "read" | null };

async function readState<T>(reader: () => Promise<T>, fallback: T): Promise<ReadState<T>> {
  try {
    return { data: await reader(), error: null };
  } catch (error) {
    return {
      data: fallback,
      error: error instanceof Error && error.message === "WORKFORCE_SCHEMA_NOT_PROVISIONED"
        ? "schema"
        : "read",
    };
  }
}

export default async function WorkforcePage() {
  const context = await requireCurrentAccessContext();
  const canReadShifts =
    canPerform(context, "shift.read", "Physio") || canPerform(context, "shift.read", "Dental");
  const canReadLeave =
    canPerform(context, "leave.read", "Physio") || canPerform(context, "leave.read", "Dental");

  if (!canReadShifts && !canReadLeave) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        এই account-এর জন্য Workforce access দেওয়া নেই।
      </div>
    );
  }

  const managerTier = isWorkforceManagerTier(context);
  const [shiftState, leaveState, directoryState] = await Promise.all([
    canReadShifts ? readState(() => listShiftsForContext(context), []) : Promise.resolve({ data: [], error: null }),
    canReadLeave ? readState(() => listLeaveForContext(context), []) : Promise.resolve({ data: [], error: null }),
    managerTier ? readState(() => getWebStaffDirectory(), []) : Promise.resolve({ data: [], error: null }),
  ]);

  const staffOptions = directoryState.data
    .filter((item) =>
      item.status === "Active" &&
      (item.primaryDepartment === "Physio" || item.primaryDepartment === "Dental") &&
      canPerform(context, "shift.manage", item.primaryDepartment)
    )
    .map((item) => ({
      staffId: item.staffId,
      fullName: item.fullName || item.staffId,
      primaryDepartment: item.primaryDepartment,
    }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeading
        title="Workforce"
        subtitle="Shift scheduling and leave management"
      />
      <WorkforceClient
        currentStaffId={context.staffId}
        canApplyMonthlyRoster={context.roles.includes("Owner")}
        canReadShifts={canReadShifts}
        canReadLeave={canReadLeave}
        canManageShifts={
          canPerform(context, "shift.manage", "Physio") ||
          canPerform(context, "shift.manage", "Dental")
        }
        canRequestLeave={
          canPerform(context, "leave.request", "Physio") ||
          canPerform(context, "leave.request", "Dental")
        }
        canDecideLeave={
          canPerform(context, "leave.decide", "Physio") ||
          canPerform(context, "leave.decide", "Dental")
        }
        canCancelAnyLeave={
          canPerform(context, "leave.cancel", "Physio") ||
          canPerform(context, "leave.cancel", "Dental")
        }
        initialShifts={shiftState.data}
        shiftsError={shiftState.error}
        initialLeave={leaveState.data}
        leaveError={leaveState.error}
        staffOptions={staffOptions}
        staffOptionsUnavailable={directoryState.error !== null}
      />
    </div>
  );
}
