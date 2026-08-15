import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ScopeSelector from "@/components/ScopeSelector";
import { formatBDT, formatDateBn } from "@/lib/format";
import {
  getTodaysCollection,
  getMonthBusinessPosition,
  getSalaryStatus,
} from "@/lib/calculations";
import { getScopedCashPosition } from "@/lib/scopedCash";
import { getOwnerControlSnapshot } from "@/lib/controls";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import {
  allowedScopesForContext,
  resolveAuthorizedScope,
} from "@/lib/webos/scope";
import {
  PageHeading,
  MetricGrid,
  Section,
  ActionRow,
} from "@/components/WorkspaceUI";

function percent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, value).toFixed(0)}%`;
}

export default async function FinancePage() {
  const context = await requireCurrentAccessContext();
  if (!context.roles.includes("Owner")) redirect("/operations");

  const cookieStore = await cookies();
  const allowedScopes = allowedScopesForContext(context);
  const scope = resolveAuthorizedScope(
    context,
    cookieStore.get("relife_scope")?.value
  );
  const now = new Date();

  const [cash, todays, month, salary, controls] = await Promise.all([
    getScopedCashPosition(scope, now),
    getTodaysCollection(now),
    getMonthBusinessPosition(scope, now),
    getSalaryStatus(scope, now),
    getOwnerControlSnapshot(),
  ]);

  const scopeCollection =
    scope === "physio"
      ? todays.physio
      : scope === "dental"
        ? todays.dental
        : todays.combined;
  const costRecovery =
    month.totalBusinessLiability > 0
      ? (month.monthCollection / month.totalBusinessLiability) * 100
      : 0;
  const pendingExpenses = controls.pendingExpenses.filter(
    (item) => scope === "combined" || item.workbook === scope
  ).length;
  const pendingCash = controls.pendingCashMovements.filter(
    (item) => scope === "combined" || item.workbook === scope
  ).length;

  return (
    <div>
      <PageHeading
        title="Finance"
        subtitle={`${formatDateBn(now)} · Cash, expenses, salary and business position`}
      />

      <div className="mb-4">
        <ScopeSelector current={scope} allowed={allowedScopes} />
      </div>

      <Section title="Current position" subtitle="Current month custody balance">
        <div className="px-4 pb-4">
          <MetricGrid
            items={[
              { label: "Reception", value: formatBDT(cash.reception) },
              { label: "Home Treasury", value: formatBDT(cash.homeTreasury) },
              { label: "Bank", value: formatBDT(cash.bank) },
            ]}
          />
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-500">Total cash position</span>
            <span className="text-base font-semibold tabular-nums text-slate-950">
              {formatBDT(cash.total)}
            </span>
          </div>
        </div>
      </Section>

      <Section title="This month" subtitle="Business performance and commitments">
        <div className="grid grid-cols-2 gap-px bg-slate-100 border-y border-slate-100">
          {[
            ["Today collected", formatBDT(scopeCollection)],
            ["Month collected", formatBDT(month.monthCollection)],
            ["Business liability", formatBDT(month.totalBusinessLiability)],
            ["Cost recovery", percent(costRecovery)],
            ["Salary paid", formatBDT(salary.paidOrAdvance)],
            ["Salary remaining", formatBDT(salary.remainingDue)],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-4 py-3">
              <p className="text-sm font-semibold tabular-nums text-slate-950">{value}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              {month.surplusOrUncovered >= 0 ? "Surplus" : "Still uncovered"}
            </span>
            <span
              className={`text-sm font-semibold tabular-nums ${
                month.surplusOrUncovered >= 0 ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {formatBDT(Math.abs(month.surplusOrUncovered))}
            </span>
          </div>
        </div>
      </Section>

      <Section title="Finance workflows" subtitle="All money actions in one place">
        <ActionRow
          href="/operations"
          icon="payment"
          title="Payments"
          subtitle="Collect and review patient payments"
        />
        <ActionRow
          href="/operations"
          icon="expense"
          title="Expenses"
          subtitle="Request, approve and pay clinic expenses"
          meta={pendingExpenses || undefined}
        />
        <ActionRow
          href="/more"
          icon="approval"
          title="Pending approvals"
          subtitle="Owner decisions for expense and cash requests"
          meta={pendingExpenses + pendingCash || undefined}
        />
        <ActionRow
          href="/operations"
          icon="cash"
          title="Cash handover"
          subtitle="Reception, Home Treasury and Bank movement"
          meta={pendingCash || undefined}
        />
        <ActionRow
          href="/operations"
          icon="salary"
          title="Salary"
          subtitle="Salary and advance workflow"
        />
        <ActionRow
          href="/finance/history"
          icon="history"
          title="Transaction history"
          subtitle="Expenses, salary and cash movement evidence"
        />
      </Section>
    </div>
  );
}
