import { cookies } from "next/headers";
import { Card, Row } from "@/components/Card";
import { formatBDT } from "@/lib/format";
import {
  getMonthBusinessPosition,
  getSalaryStatus,
  getTodaysCollection,
} from "@/lib/calculations";
import { getPatients, patientsInScope } from "@/lib/patients";
import type { Scope } from "@/lib/types";

function readScope(value: string | undefined): Scope {
  if (value === "physio" || value === "dental" || value === "combined") return value;
  return "combined";
}

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function bdMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function percent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.round(value))}%`;
}

export default async function ReportsPage() {
  const cookieStore = await cookies();
  const scope = readScope(cookieStore.get("relife_scope")?.value);
  const now = new Date();

  const [allPatients, todays, month, salary] = await Promise.all([
    getPatients(),
    getTodaysCollection(now),
    getMonthBusinessPosition(scope, now),
    getSalaryStatus(scope, now),
  ]);

  const patients = patientsInScope(allPatients, scope);
  const monthKey = bdMonthKey(now);
  const activePatients = patients.filter((patient) => patient.status.toLowerCase() === "active").length;
  const newPatients = patients.filter((patient) => patient.registrationDate.startsWith(monthKey)).length;
  const patientDue = patients.reduce((sum, patient) => sum + patient.due, 0);
  const todayCollection =
    scope === "physio" ? todays.physio : scope === "dental" ? todays.dental : todays.combined;
  const recovery = month.totalBusinessLiability > 0
    ? (month.monthCollection / month.totalBusinessLiability) * 100
    : 0;

  return (
    <div>
      <Card title="Operational report" subtitle={`Scope: ${SCOPE_LABEL[scope]} · Current month`}>
        <Row label="Total patients" value={String(patients.length)} />
        <Row label="Active patients" value={String(activePatients)} />
        <Row label="New patients this month" value={String(newPatients)} />
        <Row label="Today collection" value={formatBDT(todayCollection)} emphasis />
        <Row
          label="Patient master due"
          value={formatBDT(patientDue)}
          tone={patientDue > 0 ? "negative" : "neutral"}
        />
      </Card>

      <Card title="Business report" subtitle={`Scope: ${SCOPE_LABEL[scope]}`}>
        <Row label="Month collection" value={formatBDT(month.monthCollection)} emphasis />
        <Row label="Variable clinic expense" value={formatBDT(month.variableClinicExpense)} />
        <Row label="Fixed overhead" value={formatBDT(month.fixedOverhead)} />
        <Row label="Fixed salary commitment" value={formatBDT(month.fixedSalaryCommitment)} />
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Total business liability" value={formatBDT(month.totalBusinessLiability)} />
          <Row label="Cost recovery" value={percent(recovery)} emphasis />
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row
            label={month.surplusOrUncovered >= 0 ? "Surplus" : "এখনও খরচ ওঠেনি"}
            value={formatBDT(Math.abs(month.surplusOrUncovered))}
            emphasis
            tone={month.surplusOrUncovered >= 0 ? "positive" : "negative"}
          />
        </div>
      </Card>

      <Card title="Salary report" subtitle={`Scope: ${SCOPE_LABEL[scope]}`}>
        <Row label="Fixed commitment" value={formatBDT(salary.fixedCommitment)} />
        <Row label="Paid / advance" value={formatBDT(salary.paidOrAdvance)} />
        <Row
          label="Remaining due"
          value={formatBDT(salary.remainingDue)}
          emphasis
          tone={salary.remainingDue > 0 ? "negative" : "positive"}
        />
      </Card>

      {month.fixedOverhead === 0 && (
        <p className="px-1 text-[11px] text-amber-600">
          Fixed overhead এখনও confirmed source থেকে wired হয়নি, তাই report-এ আপাতত ৳0।
        </p>
      )}
    </div>
  );
}
