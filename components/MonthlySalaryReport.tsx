"use client";

import { formatBDT } from "@/lib/format";

interface StaffRow {
  staffId: string;
  fullName: string;
  salary: number;
  paidThisMonth: number;
  remainingDue: number;
  status: string;
}

interface PaymentRow {
  staffId: string;
  date: string;
  amount: number;
  type: string;
}

export default function MonthlySalaryReport({
  staff,
  payments,
  month,
}: {
  staff: StaffRow[];
  payments: PaymentRow[];
  month: string;
}) {
  const active = staff.filter((s) => s.status === "Active");
  const totalCommitment = active.reduce((sum, s) => sum + s.salary, 0);
  const totalPaid = active.reduce((sum, s) => sum + s.paidThisMonth, 0);
  const totalDue = active.reduce((sum, s) => sum + s.remainingDue, 0);
  const settled = active.filter((s) => s.remainingDue === 0).length;
  const pending = active.filter((s) => s.remainingDue > 0).length;

  // Calculate payment recovery %
  const recovery = totalCommitment > 0 ? (totalPaid / totalCommitment) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-blue-50 p-3 text-center">
          <p className="text-[10px] text-blue-700">Active Staff</p>
          <p className="mt-1 text-lg font-bold text-blue-950">{active.length}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-3 text-center">
          <p className="text-[10px] text-emerald-700">Settled</p>
          <p className="mt-1 text-lg font-bold text-emerald-950">{settled}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-3 text-center">
          <p className="text-[10px] text-red-700">Pending</p>
          <p className="mt-1 text-lg font-bold text-red-950">{pending}</p>
        </div>
        <div className="rounded-lg bg-purple-50 p-3 text-center">
          <p className="text-[10px] text-purple-700">Recovery</p>
          <p className="mt-1 text-lg font-bold text-purple-950">{recovery.toFixed(1)}%</p>
        </div>
      </div>

      {/* Summary Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-900">Staff Name</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">Commitment</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">Paid</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-900">Due</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-900">Status</th>
            </tr>
          </thead>
          <tbody>
            {active.map((s) => {
              const percent = s.salary > 0 ? (s.paidThisMonth / s.salary) * 100 : 0;
              return (
                <tr key={s.staffId} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-900">
                    <div className="font-medium">{s.fullName}</div>
                    <div className="text-[11px] text-slate-500">{s.staffId}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {formatBDT(s.salary)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                    {formatBDT(s.paidThisMonth)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-700">
                    {formatBDT(s.remainingDue)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-1 text-[10px] font-semibold ${
                        s.remainingDue === 0
                          ? "bg-emerald-100 text-emerald-700"
                          : percent >= 75
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {s.remainingDue === 0 ? "Settled" : `${percent.toFixed(0)}%`}
                    </span>
                  </td>
                </tr>
              );
            })}
            <tr className="bg-slate-100 font-bold">
              <td className="px-4 py-3 text-slate-900">TOTAL</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                {formatBDT(totalCommitment)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                {formatBDT(totalPaid)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-red-700">
                {formatBDT(totalDue)}
              </td>
              <td className="px-4 py-3 text-center">
                <span className="inline-block rounded-full bg-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-700">
                  {recovery.toFixed(1)}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Insights */}
      <div className="space-y-2 rounded-lg bg-slate-50 p-4">
        <h4 className="text-xs font-semibold text-slate-900">📋 Month Summary</h4>
        <div className="space-y-1 text-xs text-slate-600">
          <p>
            • <strong>{settled}/{active.length}</strong> staff fully settled
          </p>
          <p>
            • <strong>{pending}</strong> staff with pending payments
          </p>
          <p>
            • <strong>{formatBDT(totalDue)}</strong> total outstanding
          </p>
          <p>
            • Recovery rate: <strong>{recovery.toFixed(1)}%</strong> of total commitment
          </p>
        </div>
      </div>
    </div>
  );
}
