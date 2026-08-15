import { cookies } from "next/headers";
import ScopeSelector from "@/components/ScopeSelector";
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
import {
  allowedScopesForContext,
  resolveAuthorizedScope,
} from "@/lib/webos/scope";
import {
  PageHeading,
  MetricGrid,
  Section,
} from "@/components/WorkspaceUI";

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
  const allowedScopes = allowedScopesForContext(context);
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
      <PageHeading
        title="Reports"
        subtitle="Operational and financial analytics in one workspace"
      />

      {allowedScopes.length > 1 && (
        <div className="mb-4">
          <ScopeSelector current={scope} allowed={allowedScopes} />
        </div>
      )}

      {canReadOperational && (
        <Section title="Patient performance" subtitle="Current month">
          <div className="px-4 pb-4">
            <MetricGrid
              items={[
                { label: "Patients", value: String(patients.length) },
                { label: "Active", value: String(activePatients), tone: "positive" },
                { label: "New this month", value: String(newPatients) },
              ]}
            />
            {canReadFinancial && patientDue > 0 && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-500">Patient master due</span>
                <span className="text-sm font-semibold tabular-nums text-red-600">
                  {formatBDT(patientDue)}
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {canReadFinancial && month && salary && (
        <>
          <Section title="Business performance" subtitle="Current month">
            <div className="grid grid-cols-2 gap-px border-y border-slate-100 bg-slate-100">
              {[
                ["Today collection", formatBDT(todayCollection)],
                ["Month collection", formatBDT(month.monthCollection)],
                ["Variable expense", formatBDT(month.variableClinicExpense)],
                ["Fixed overhead", formatBDT(month.fixedOverhead)],
                ["Business liability", formatBDT(month.totalBusinessLiability)],
                ["Cost recovery", percent(recovery)],
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

          <Section title="Salary position">
            <div className="px-4 pb-4">
              <MetricGrid
                items={[
                  { label: "Commitment", value: formatBDT(salary.fixedCommitment) },
                  { label: "Paid / advance", value: formatBDT(salary.paidOrAdvance), tone: "positive" },
                  { label: "Remaining", value: formatBDT(salary.remainingDue), tone: salary.remainingDue > 0 ? "warning" : "positive" },
                ]}
              />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
