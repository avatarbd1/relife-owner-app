import Link from "next/link";
import { cookies } from "next/headers";
import SalaryManagementClient from "@/components/SalaryManagementClient";
import SalaryPaymentForm from "@/components/SalaryPaymentForm";
import SalaryBulkExport from "@/components/SalaryBulkExport";
import MonthlySalaryReport from "@/components/MonthlySalaryReport";
import { StatusBadge } from "@/components/FeedbackUI";
import { getSalaryPayments, getStaff } from "@/lib/data";
import type { Department, Scope } from "@/lib/types";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { resolveAuthorizedScope } from "@/lib/webos/scope";

function monthDhaka(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function inScope(scope: Scope, department: Department): department is "Physio" | "Dental" {
  if (department !== "Physio" && department !== "Dental") return false;
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function dateKey(value: string | undefined): string {
  return String(value || "").trim().slice(0, 10);
}

export default async function SalaryPage() {
  const [context, cookieStore, allStaff, allPayments] = await Promise.all([
    requireCurrentAccessContext(),
    cookies(),
    getStaff(),
    getSalaryPayments(),
  ]);
  const scope = resolveAuthorizedScope(context, cookieStore.get("relife_scope")?.value);
  const readableDepartments = (["Physio", "Dental"] as const).filter(
    (department) => inScope(scope, department) && canPerform(context, "salary.read", department)
  );
  const canPay = (["Physio", "Dental"] as const).some(
    (department) => inScope(scope, department) && canPerform(context, "salary.pay", department)
  );

  if (readableDepartments.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        এই account-এর জন্য salary ledger access দেওয়া নেই।
      </div>
    );
  }

  const month = monthDhaka();
  const payments = allPayments.filter(
    (row) =>
      row.department !== "All" &&
      readableDepartments.includes(row.department as "Physio" | "Dental") &&
      inScope(scope, row.department)
  );
  const currentPaid = new Map<string, number>();
  for (const row of payments) {
    if (!dateKey(row.paidAt || row.date).startsWith(month)) continue;
    const status = String(row.status || "Paid").trim().toLowerCase();
    if (status && status !== "paid") continue;
    currentPaid.set(row.staffId, (currentPaid.get(row.staffId) || 0) + Number(row.amount || 0));
  }

  const staff = allStaff.flatMap((item) => {
    if (item.role.trim().toLowerCase() === "owner") return [];
    if (!inScope(scope, item.department)) return [];
    if (!readableDepartments.includes(item.department)) return [];
    const paidThisMonth = currentPaid.get(item.staffId) || 0;
    return [{
      staffId: item.staffId,
      fullName: item.fullName,
      role: item.role,
      department: item.department,
      salary: Number(item.salary || 0),
      status: item.status,
      paidThisMonth,
      remainingDue: Math.max(0, Number(item.salary || 0) - paidThisMonth),
    }];
  });

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">Payroll</p>
            <h1 className="mt-1 text-2xl font-bold">Salary management</h1>
            <p className="mt-1 text-xs leading-5 text-slate-300">Fixed salary commitment, paid/advance history and remaining due.</p>
          </div>
          <StatusBadge tone={canPay ? "info" : "neutral"} className="border-white/10">{canPay ? "Owner pay" : "Read only"}</StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/finance/history" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">Salary history</Link>
          {context.roles.includes("Owner") && <Link href="/finance" className="min-h-10 rounded-lg bg-blue-400/15 px-3 py-2.5 text-xs font-semibold text-blue-100 ring-1 ring-blue-300/20">Finance dashboard</Link>}
        </div>
      </section>

      {/* Monthly Settlement Report */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Monthly Settlement</h2>
          <p className="text-xs text-slate-600">Overview of salary status for {month}</p>
        </div>
        <MonthlySalaryReport
          staff={staff}
          payments={payments.map((row) => ({
            staffId: row.staffId,
            date: row.date,
            amount: row.amount,
            type: row.type,
          }))}
          month={month}
        />
      </section>

      {/* Bulk Export & Reports */}
      <SalaryBulkExport staff={staff} month={month} />

      {/* Individual Payment Forms */}
      {canPay && staff.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Record Payments</h2>
            <p className="text-xs text-slate-600">Enter individual salary payments for staff</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {staff
              .filter((s) => s.remainingDue > 0)
              .sort((a, b) => b.remainingDue - a.remainingDue)
              .slice(0, 10)
              .map((s) => (
                <SalaryPaymentForm
                  key={s.staffId}
                  staffId={s.staffId}
                  staffName={s.fullName}
                  department={s.department}
                  commitment={s.salary}
                  paidThisMonth={s.paidThisMonth}
                />
              ))}
          </div>
        </section>
      )}

      {/* Legacy Salary Management (Hidden by default, kept for compatibility) */}
      <details className="group">
        <summary className="cursor-pointer py-3 text-sm font-semibold text-slate-600 hover:text-slate-900">
          ▸ View detailed salary history
        </summary>
        <div className="mt-3 space-y-3">
          <SalaryManagementClient
            staff={staff}
            payments={payments.map((row) => ({
              id: row.id,
              date: row.date,
              staffId: row.staffId,
              staffName: row.staffName,
              department: row.department as "Physio" | "Dental",
              amount: row.amount,
              type: row.type,
              paidFrom: row.paidFrom,
              status: row.status,
            }))}
            canPay={canPay}
          />
        </div>
      </details>
    </div>
  );
}
