import { cookies } from "next/headers";
import { Card, Row } from "@/components/Card";
import { formatBDT, formatDateBn } from "@/lib/format";
import {
  getCashPosition,
  getTodaysCollection,
  getMonthBusinessPosition,
  getSalaryStatus,
} from "@/lib/calculations";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") {
    return value;
  }
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function percent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, value).toFixed(1)}%`;
}

export default async function FinancePage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const now = new Date();

  const [cash, todays, month, salary] = await Promise.all([
    getCashPosition(now),
    getTodaysCollection(now),
    getMonthBusinessPosition(scope, now),
    getSalaryStatus(scope, now),
  ]);

  const costRecovery =
    month.totalBusinessLiability > 0
      ? (month.monthCollection / month.totalBusinessLiability) * 100
      : 0;
  const salaryPaidRate =
    salary.fixedCommitment > 0
      ? (salary.paidOrAdvance / salary.fixedCommitment) * 100
      : 0;

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        {formatDateBn(now)} &middot; Scope: {SCOPE_LABEL[scope]}
      </p>

      <Card title="Current Cash Position" subtitle="Current month custody balance">
        <Row label="Reception" value={formatBDT(cash.reception)} />
        <Row label="Home Treasury" value={formatBDT(cash.homeTreasury)} />
        <Row label="Digital / Bank" value={formatBDT(cash.bank)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Total cash position" value={formatBDT(cash.total)} emphasis />
        </div>
      </Card>

      <Card title="Collection" subtitle="Source: 06_Payments">
        <Row label="Today · Physio" value={formatBDT(todays.physio)} />
        <Row label="Today · Dental" value={formatBDT(todays.dental)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Today · Combined" value={formatBDT(todays.combined)} emphasis />
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label={`Month · ${SCOPE_LABEL[scope]}`} value={formatBDT(month.monthCollection)} emphasis />
        </div>
      </Card>

      <Card title="Business Cost & Recovery" subtitle={`Scope: ${SCOPE_LABEL[scope]}`}>
        <Row label="Variable clinic expense" value={formatBDT(month.variableClinicExpense)} />
        <Row label="Fixed overhead" value={formatBDT(month.fixedOverhead)} />
        <Row label="Fixed salary commitment" value={formatBDT(month.fixedSalaryCommitment)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Total business liability" value={formatBDT(month.totalBusinessLiability)} />
          <Row label="Cost recovery" value={percent(costRecovery)} emphasis />
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label={month.surplusOrUncovered >= 0 ? "Surplus" : "Still uncovered"}
            value={formatBDT(Math.abs(month.surplusOrUncovered))}
            emphasis
            tone={month.surplusOrUncovered >= 0 ? "positive" : "negative"}
          />
        </div>
        {month.fixedOverhead === 0 && (
          <p className="mt-2 text-[11px] text-amber-600">
            Fixed overhead source এখনও confirm হয়নি; তাই এই অংশে আপাতত ৳0 ধরা হয়েছে।
          </p>
        )}
      </Card>

      <Card title="Salary Status" subtitle={`Scope: ${SCOPE_LABEL[scope]}`}>
        <Row label="Fixed commitment" value={formatBDT(salary.fixedCommitment)} />
        <Row label="Paid / advance" value={formatBDT(salary.paidOrAdvance)} />
        <Row label="Paid rate" value={percent(salaryPaidRate)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label="Remaining due"
            value={formatBDT(salary.remainingDue)}
            emphasis
            tone={salary.remainingDue > 0 ? "negative" : "positive"}
          />
        </div>
      </Card>
    </div>
  );
}
