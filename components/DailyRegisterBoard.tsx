"use client";

import Link from "next/link";
import { formatBDT } from "@/lib/format";
import type { WebDailyRegisterRow } from "@/lib/webos/dailyRegister";

interface DailyRegisterData {
  date: string;
  rows: WebDailyRegisterRow[];
  totals: {
    entries: number;
    sessions: number;
    amount: number;
    discount: number;
    due: number;
  };
}

interface ActivityCounts {
  patients: number;
  sessions: number;
  appointments: number;
}

export default function DailyRegisterBoard({
  registerData,
  activityCounts,
  lowStockCount,
  isOwner,
}: {
  registerData: DailyRegisterData;
  activityCounts: ActivityCounts;
  lowStockCount: number;
  isOwner: boolean;
}) {
  const paidCount = registerData.rows.filter((r) => r.status === "Paid").length;
  const partialCount = registerData.rows.filter((r) => r.status === "Partial").length;
  const dueCount = registerData.rows.filter((r) => r.status === "Due").length;

  return (
    <div className="space-y-4">
      {/* Patient Counter Board */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">📊 Today's Activity</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-[11px] font-medium text-blue-700">New patients</p>
            <p className="mt-1 text-xl font-bold text-blue-950">{activityCounts.patients}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-[11px] font-medium text-emerald-700">Sessions</p>
            <p className="mt-1 text-xl font-bold text-emerald-950">{activityCounts.sessions}</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-[11px] font-medium text-amber-700">Appointments</p>
            <p className="mt-1 text-xl font-bold text-amber-950">{activityCounts.appointments}</p>
          </div>
          <div className="rounded-lg bg-purple-50 p-3">
            <p className="text-[11px] font-medium text-purple-700">Total collection</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-purple-950">
              {formatBDT(registerData.totals.amount)}
            </p>
          </div>
        </div>
      </div>

      {/* Collection Status & Alerts */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">💰 Collection Status</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[10px] text-emerald-700">Paid</p>
            <p className="mt-1 text-lg font-bold text-emerald-950">{paidCount}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] text-amber-700">Partial</p>
            <p className="mt-1 text-lg font-bold text-amber-950">{partialCount}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-[10px] text-red-700">Due</p>
            <p className="mt-1 text-lg font-bold text-red-950">{dueCount}</p>
          </div>
        </div>

        {/* Alerts */}
        <div className="mt-4 space-y-2">
          {lowStockCount > 0 && (
            <Link
              href="/inventory"
              className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-xs hover:bg-red-100"
            >
              <span className="text-red-700">
                ⚠️ {lowStockCount} inventory item{lowStockCount > 1 ? "s" : ""} low stock
              </span>
              <span className="text-red-600">→</span>
            </Link>
          )}

          {isOwner && dueCount > 0 && (
            <Link
              href="/payments"
              className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs hover:bg-amber-100"
            >
              <span className="text-amber-700">
                📋 {dueCount} patient{dueCount > 1 ? "s" : ""} with due payment
              </span>
              <span className="text-amber-600">→</span>
            </Link>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">⚡ Quick Actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Link
            href="/patients/new"
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-center text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            ➕ New Patient
          </Link>
          <Link
            href="/appointments/new"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            📅 Appointment
          </Link>
          <Link
            href="/payments"
            className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5 text-center text-xs font-semibold text-purple-700 hover:bg-purple-100"
          >
            💳 Collect Payment
          </Link>

          {isOwner && (
            <>
              <Link
                href="/expenses"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-center text-xs font-semibold text-amber-700 hover:bg-amber-100"
              >
                📝 Expenses
              </Link>
              <Link
                href="/finance/cash-receive"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                💵 Cash
              </Link>
              <Link
                href="/salary"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                💰 Salary
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Today's Session Log */}
      {registerData.rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">📋 Today's Collections</h2>
            <span className="text-[10px] text-slate-500">
              {registerData.rows.length} entries
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {registerData.rows.slice(0, 10).map((row, index) => (
              <div
                key={`${row.receiptNo}-${index}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
              >
                <div className="min-w-0 text-xs">
                  <p className="truncate font-semibold text-slate-900">
                    {row.sl ? `${row.sl}.` : ""} {row.patientName}
                  </p>
                  <p className="text-slate-500">
                    {row.receiptNo} · {row.sessions} session{row.sessions > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p
                    className={`font-semibold ${
                      row.status === "Paid"
                        ? "text-emerald-700"
                        : row.status === "Partial"
                          ? "text-amber-700"
                          : "text-red-700"
                    }`}
                  >
                    {row.status}
                  </p>
                  <p className="tabular-nums text-slate-600">{formatBDT(row.amount)}</p>
                </div>
              </div>
            ))}

            {registerData.rows.length > 10 && (
              <Link
                href="/payments"
                className="mt-2 block text-center text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                View all {registerData.rows.length} entries →
              </Link>
            )}
          </div>

          {/* Summary Footer */}
          <div className="mt-3 border-t border-slate-200 pt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
              <div>
                <p className="text-[10px] text-slate-500">Total Paid</p>
                <p className="mt-0.5 font-bold text-emerald-700">
                  {formatBDT(
                    registerData.rows
                      .filter((r) => r.status === "Paid")
                      .reduce((sum, r) => sum + r.amount, 0)
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Discount</p>
                <p className="mt-0.5 font-bold text-amber-700">
                  {formatBDT(registerData.totals.discount)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Total Due</p>
                <p className="mt-0.5 font-bold text-red-700">
                  {formatBDT(registerData.totals.due)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Net Collection</p>
                <p className="mt-0.5 font-bold text-slate-900">
                  {formatBDT(
                    registerData.totals.amount - registerData.totals.discount
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
