import { cookies } from "next/headers";
import { Card, Row } from "@/components/Card";
import { formatBDT } from "@/lib/format";
import {
  getMonthBusinessPosition,
  getSalaryStatus,
  getTodaysCollection,
} from "@/lib/calculations";
import { getPatients } from "@/lib/patients";
import type { Department, Scope } from "@/lib/types";
import { actionsForRoles, canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

const SCOPE_LABEL: Record<Scope, string> = {
  combined: "Combined",
  physio: "Physio",
  dental: "Dental",
};

function scopeAllows(scope: Scope, department: Department): boolean {
  if (scope === "combined") return department === "Physio" || department === "Dental";
  return department === (scope === "physio" ? "Physio" : "Dental");
}

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
  const [cookieStore, context] = await Promise.all([
    cookies(),
    requireCurrentAccessContext(),
  ]);
  const actions = new Set(actionsForRoles(context.roles));
  const canReadOperational = actions.has("report.read_operational");
  const canReadFinancial = actions.has("report.read_financial");

  if (!canReadOperational && !canReadFinancial) {
    return (
      <div className="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
        এই account-এর জন্য Reports access দেওয়া নেই।
      </div>
    );
  }

  const scope = resolveAuthorizedScope(
    context,
    cookieStore.get("relife_scope")?.value
  );
  const now = new Date();
  const monthKey = bdMonthKey(now);

  const allPatients = canReadOperational ? await getPatients() : [];
  const patients = allPatients.filter(
    (patient) =>
      scopeAllows(scope, patient.department) &&
      canPerform(context, "report.read_operational", patient.department)
  );
  const activePatients = patients.filter(
    (patient) => patient.status.toLowerCase() === "active"
  ).length;
  const newPatients = patients.filter((patient) =>
    patient.registrationDate.startsWith(monthKey)
  ).length;
  const patientDue = patients.reduce((sum, patient) => sum + patient.due, 0);

  const financial = canReadFinancial
    ? await Promise.all([
        getTodaysCollection(now),
        getMonthBusinessPosition(scope, now),
        getSalaryStatus(scope, now),
      ])
    : null;

  const todays = financial?.[0];
  const month = financial?.[1];
  const salary = financial?.[2];
  const todayCollection = todays
    ? scope === "physio"
      ? todays.physio
      : scope === "dental"
        ? todays.dental
        : todays.combined
    : 0;
  const recovery = month && month.totalBusinessLiability > 0
    ? (month.monthCollection / month.totalBusinessLiability) * 100
    : 0;

  return (
    <div>
      {canReadOperational && (
        <Card title="Operational report" subtitle={`Scope: ${SCOPE_LABEL[scope]} · Current month`}>
          <Row label="Total patients" value={String(patients.length)} />
          <Row label="Active patients" value={String(activePatients)} />
          <Row label="New patients this month" value={String(newPatients)} />
          {canReadFinancial && (
            <>
              <Row label="Today collection" value={formatBDT(todayCollection)} emphasis />
              <Row
                label="Patient master due"
                value={formatBDT(patientDue)}
                tone={patientDue > 0 ? "negative" : "neutral"}
              />
            </>
          )}
        </Card>
      )}

      {canReadFinancial && month && salary && (
        <>
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
        </>
      )}
    </div>
  );
}
