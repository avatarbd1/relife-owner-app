import Link from "next/link";
import { cookies } from "next/headers";
import ExpenseRequestForm from "@/components/ExpenseRequestForm";
import ExpenseApprovalDashboard from "@/components/ExpenseApprovalDashboard";
import { PageHeading, Section } from "@/components/WorkspaceUI";
import { StatusBadge } from "@/components/FeedbackUI";
import type { Scope } from "@/lib/types";
import { canPerform, actionsForRoles } from "@/lib/webos/access";
import { getFinanceOperationsSnapshot } from "@/lib/webos/financeOps";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

export default async function ExpensesPage() {
  const [context, cookieStore] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
  ]);

  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const actions = new Set(actionsForRoles(context.roles));
  const canRequest = actions.has("expense.request");
  const canApprove = context.roles.includes("Owner");

  // Get pending expenses
  let snapshot: Awaited<ReturnType<typeof getFinanceOperationsSnapshot>> | null = null;
  if (canApprove) {
    snapshot = await getFinanceOperationsSnapshot(context, scope);
  }

  const pendingExpenses = snapshot?.approvedExpenses?.map((exp) => ({
    id: exp.id,
    date: exp.date,
    category: exp.category,
    amount: exp.amount,
    note: exp.note,
    requestedBy: exp.requestedBy,
    department: exp.department,
  })) || [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeading
        title="📝 Expense Requests"
        subtitle={`${LABEL[scope]} · Request and approve clinic expenses`}
        action={
          <Link
            href="/finance/history"
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            History
          </Link>
        }
      />

      {/* Pending Approval Alert */}
      {canApprove && pendingExpenses.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-amber-900">
                {pendingExpenses.length} expense{pendingExpenses.length > 1 ? "s" : ""} pending approval
              </p>
              <p className="mt-0.5 text-[11px] text-amber-700">
                Review and approve/reject below
              </p>
            </div>
            <StatusBadge tone="warning">{pendingExpenses.length}</StatusBadge>
          </div>
        </div>
      )}

      {/* Request Form (if authorized) */}
      {canRequest && (
        <Section title="🆕 New Expense Request">
          <p className="mb-4 text-xs text-slate-500">
            Request an expense. Owner will review and approve/reject.
          </p>
          <ExpenseRequestForm
            department={scope === "dental" ? "Dental" : "Physio"}
            onSuccess={() => {
              // Page will refresh automatically
            }}
          />
        </Section>
      )}

      {/* Approval Dashboard (Owner only) */}
      {canApprove && (
        <Section title="✅ Approve Requests">
          <ExpenseApprovalDashboard pendingExpenses={pendingExpenses} />
        </Section>
      )}

      {/* No Access Message */}
      {!canRequest && !canApprove && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          এই page-এ access নেই।
        </div>
      )}
    </div>
  );
}
