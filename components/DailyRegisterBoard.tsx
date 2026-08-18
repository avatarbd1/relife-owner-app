"use client";

import Link from "next/link";
import { formatBDT } from "@/lib/format";
import type { WebDailyRegisterRow } from "@/lib/webos/dailyRegister";

interface DailyRegisterData {
  date: string;
  rows: Array<WebDailyRegisterRow & { moneyVisible?: boolean }>;
  totals: {
    entries: number;
    sessions: number;
    amount: number;
    discount: number;
    due: number;
  };
  hasMoneyAccess: boolean;
}

interface ActivityCounts {
  patients: number;
  sessions: number;
  appointments: number;
}

interface QuickActions {
  patient: boolean;
  appointment: boolean;
  payment: boolean;
  expense: boolean;
}

export default function DailyRegisterBoard({
  registerData,
  activityCounts,
  lowStockCount,
  quickActions,
  isOwner,
}: {
  registerData: DailyRegisterData;
  activityCounts: ActivityCounts;
  lowStockCount: number;
  quickActions: QuickActions;
  isOwner: boolean;
}) {
  const paidCount = registerData.rows.filter((row) => row.status === "Paid").length;
  const partialCount = registerData.rows.filter((row) => row.status === "Partial").length;
  const dueCount = registerData.rows.filter((row) => row.status === "Due").length;

  const actions = [
    quickActions.patient ? { href: "/patients/new", label: "New patient" } : null,
    quickActions.appointment ? { href: "/appointments/new", label: "Appointment" } : null,
    quickActions.payment ? { href: "/payments", label: "Collect payment" } : null,
    quickActions.expense ? { href: "/expenses", label: "Expense" } : null,
    isOwner ? { href: "/finance", label: "Finance" } : null,
    isOwner ? { href: "/salary", label: "Salary" } : null,
  ].filter((item): item is { href: string; label: string } => Boolean(item));

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Today at a glance</h2>
            <p className="mt-0.5 text-xs text-slate-500">Completed clinical work, schedule and register activity.</p>
          </div>
          <Link href="/register" className="text-xs font-semibold text-blue-800 hover:text-blue-900">
            Full register →
          </Link>
        </div>
        <div className={`mt-3 grid gap-2 ${registerData.hasMoneyAccess ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-[10px] font-medium text-blue-700">Patients treated</p>
            <p className="mt-1 text-xl font-bold text-blue-950">{activityCounts.patients}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-[10px] font-medium text-emerald-700">Sessions done</p>
            <p className="mt-1 text-xl font-bold text-emerald-950">{activityCounts.sessions}</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-[10px] font-medium text-amber-700">Appointments</p>
            <p className="mt-1 text-xl font-bold text-amber-950">{activityCounts.appointments}</p>
          </div>
          {registerData.hasMoneyAccess && (
            <div className="rounded-lg bg-violet-50 p-3">
              <p className="text-[10px] font-medium text-violet-700">Collected</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-violet-950">{formatBDT(registerData.totals.amount)}</p>
            </div>
          )}
        </div>
      </section>

      {registerData.hasMoneyAccess && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Register status</h2>
              <p className="mt-0.5 text-xs text-slate-500">Payment-row status for {registerData.date}.</p>
            </div>
            <span className="text-xs font-semibold tabular-nums text-slate-700">{registerData.totals.entries} entries</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
              <p className="text-[10px] text-emerald-700">Paid</p>
              <p className="mt-1 text-lg font-bold text-emerald-950">{paidCount}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
              <p className="text-[10px] text-amber-700">Partial</p>
              <p className="mt-1 text-lg font-bold text-amber-950">{partialCount}</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
              <p className="text-[10px] text-red-700">Due entries</p>
              <p className="mt-1 text-lg font-bold text-red-950">{dueCount}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
            <div>
              <p className="text-[10px] text-slate-500">Collected</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-slate-950">{formatBDT(registerData.totals.amount)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Discount</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-amber-800">{formatBDT(registerData.totals.discount)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Due snapshot</p>
              <p className="mt-1 text-xs font-bold tabular-nums text-red-800">{formatBDT(registerData.totals.due)}</p>
            </div>
          </div>
        </section>
      )}

      {(lowStockCount > 0 || actions.length > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
          {lowStockCount > 0 && (
            <Link href="/inventory" className="mt-3 flex min-h-11 items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 hover:bg-red-100">
              <span>{lowStockCount} low-stock inventory item{lowStockCount === 1 ? "" : "s"}</span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
          {actions.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {actions.map((action) => (
                <Link key={action.href} href={action.href} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  {action.label}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {registerData.rows.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Latest register entries</h2>
              <p className="mt-0.5 text-xs text-slate-500">First 8 entries from today’s payment register.</p>
            </div>
            <Link href="/register" className="text-xs font-semibold text-blue-800">View all →</Link>
          </div>
          <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {registerData.rows.slice(0, 8).map((row, index) => (
              <div key={`${row.department}-${row.receiptNo}-${index}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900">{row.patientName || row.patientId || row.receiptNo}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{row.department} · {row.receiptNo} · {row.sessions} session{row.sessions === 1 ? "" : "s"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[10px] font-semibold ${row.status === "Paid" ? "text-emerald-700" : row.status === "Partial" ? "text-amber-700" : "text-red-700"}`}>{row.status}</p>
                  {row.moneyVisible !== false && <p className="mt-0.5 text-xs font-semibold tabular-nums text-slate-700">{formatBDT(row.amount)}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
