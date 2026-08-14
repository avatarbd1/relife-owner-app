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

export default async function HomePage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const now = new Date();

  const [cash, todays, month, salary] = await Promise.all([
    getCashPosition(),
    getTodaysCollection(now),
    getMonthBusinessPosition(scope, now),
    getSalaryStatus(scope, now),
  ]);

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        {formatDateBn(now)} &middot; স্কোপ: {SCOPE_LABEL[scope]}
      </p>

      <Card
        title="Current Cash Position"
        subtitle="All-time · month reset হয় না"
      >
        <Row label="Reception" value={formatBDT(cash.reception)} />
        <Row label="Home Treasury" value={formatBDT(cash.homeTreasury)} />
        <Row label="Digital / Bank" value={formatBDT(cash.bank)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label="Total cash position"
            value={formatBDT(cash.total)}
            emphasis
          />
        </div>
      </Card>

      <Card title="আজকের আদায়" subtitle="Source: 06_Payments">
        <Row label="Physio collection" value={formatBDT(todays.physio)} />
        <Row label="Dental collection" value={formatBDT(todays.dental)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label="Combined"
            value={formatBDT(todays.combined)}
            emphasis
          />
        </div>
      </Card>

      <Card
        title="এই মাসের ব্যবসার অবস্থা"
        subtitle={`Scope: ${SCOPE_LABEL[scope]}`}
      >
        <Row label="Month collection" value={formatBDT(month.monthCollection)} />
        <Row
          label="Variable clinic expense"
          value={formatBDT(month.variableClinicExpense)}
        />
        <Row label="Fixed overhead" value={formatBDT(month.fixedOverhead)} />
        <Row
          label="Fixed salary commitment"
          value={formatBDT(month.fixedSalaryCommitment)}
        />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label="Total business liability"
            value={formatBDT(month.totalBusinessLiability)}
          />
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label={month.surplusOrUncovered >= 0 ? "Surplus" : "এখনও খরচ ওঠেনি"}
            value={formatBDT(Math.abs(month.surplusOrUncovered))}
            emphasis
            tone={month.surplusOrUncovered >= 0 ? "positive" : "negative"}
          />
        </div>
        {month.fixedOverhead === 0 && (
          <p className="mt-2 text-[11px] text-amber-600">
            Fixed overhead source Sheet-এ এখনও confirm হয়নি — আপাতত ৳0 ধরা
            হয়েছে।
          </p>
        )}
      </Card>

      <Card title="Salary" subtitle={`Scope: ${SCOPE_LABEL[scope]}`}>
        <Row
          label="Fixed commitment"
          value={formatBDT(salary.fixedCommitment)}
        />
        <Row label="Paid / advance" value={formatBDT(salary.paidOrAdvance)} />
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
