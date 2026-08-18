"use client";

import { useMemo, useState } from "react";
import { formatBDT } from "@/lib/format";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

type StaffRow = {
  staffId: string;
  fullName: string;
  role: string;
  department: Department;
  salary: number;
  status: "Active" | "Inactive";
  paidThisMonth: number;
  remainingDue: number;
};

function generatedDhaka(): string {
  return new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

function csvCell(value: string | number): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string | number): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function SalaryReportTools({
  staff,
  month,
}: {
  staff: StaffRow[];
  month: string;
}) {
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");

  const rows = useMemo(
    () =>
      staff.filter((item) => {
        if (filter === "all") return true;
        return item.status.toLowerCase() === filter;
      }),
    [filter, staff]
  );

  const totals = useMemo(
    () => ({
      commitment: rows.reduce((sum, item) => sum + Number(item.salary || 0), 0),
      paid: rows.reduce((sum, item) => sum + Number(item.paidThisMonth || 0), 0),
      due: rows.reduce((sum, item) => sum + Number(item.remainingDue || 0), 0),
      settled: rows.filter((item) => item.remainingDue <= 0).length,
    }),
    [rows]
  );
  const recovery = totals.commitment > 0 ? Math.min(100, (totals.paid / totals.commitment) * 100) : 0;

  function exportCsv() {
    const header = [
      "Staff ID",
      "Full Name",
      "Role",
      "Department",
      "Monthly Commitment",
      "Paid This Month",
      "Remaining Due",
      "Staff Status",
    ];
    const data = rows.map((item) => [
      item.staffId,
      item.fullName,
      item.role,
      item.department,
      item.salary,
      item.paidThisMonth,
      item.remainingDue,
      item.status,
    ]);
    const csv = [
      ["Relife Salary Settlement Report", month].map(csvCell).join(","),
      ["Generated (Asia/Dhaka)", generatedDhaka()].map(csvCell).join(","),
      "",
      header.map(csvCell).join(","),
      ...data.map((row) => row.map(csvCell).join(",")),
      "",
      ["TOTAL", "", "", "", totals.commitment, totals.paid, totals.due, ""].map(csvCell).join(","),
    ].join("\r\n");

    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relife-salary-${month}-${filter}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    haptic("success");
  }

  function printReport() {
    const reportRows = rows
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.staffId)}</td>
            <td>${escapeHtml(item.fullName)}</td>
            <td>${escapeHtml(item.role)}</td>
            <td>${escapeHtml(item.department)}</td>
            <td class="num">${escapeHtml(item.salary)}</td>
            <td class="num">${escapeHtml(item.paidThisMonth)}</td>
            <td class="num">${escapeHtml(item.remainingDue)}</td>
            <td>${escapeHtml(item.status)}</td>
          </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Relife Salary Report ${escapeHtml(month)}</title>
<style>
body{font-family:Arial,sans-serif;margin:24px;color:#0f172a}h1{font-size:22px;margin:0 0 4px}.meta{font-size:12px;color:#64748b;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#f1f5f9}.num{text-align:right}.total{font-weight:700;background:#f8fafc}.signature{margin-top:36px;font-size:12px}@media print{button{display:none}}
</style></head><body>
<h1>Relife Salary Settlement Report</h1>
<div class="meta">Month: ${escapeHtml(month)} · Generated: ${escapeHtml(generatedDhaka())} · Filter: ${escapeHtml(filter)}</div>
<table><thead><tr><th>Staff ID</th><th>Name</th><th>Role</th><th>Department</th><th>Commitment</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
<tbody>${reportRows}<tr class="total"><td colspan="4">TOTAL</td><td class="num">${totals.commitment}</td><td class="num">${totals.paid}</td><td class="num">${totals.due}</td><td></td></tr></tbody></table>
<div class="signature">Owner signature: ______________________________</div>
<script>window.addEventListener('load',()=>window.print())</script>
</body></html>`;

    const target = window.open("", "_blank", "noopener,noreferrer,width=980,height=720");
    if (!target) return;
    target.document.open();
    target.document.write(html);
    target.document.close();
    haptic("success");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Payroll report & export</h2>
          <p className="mt-0.5 text-xs text-slate-500">{month} · read-only settlement view; exports never create salary payments.</p>
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
          className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        >
          <option value="active">Active staff</option>
          <option value="inactive">Inactive staff</option>
          <option value="all">All visible staff</option>
        </select>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3 text-center"><p className="text-[10px] text-slate-500">Staff</p><p className="mt-1 text-lg font-bold text-slate-950">{rows.length}</p></div>
        <div className="rounded-lg bg-emerald-50 p-3 text-center"><p className="text-[10px] text-emerald-700">Settled</p><p className="mt-1 text-lg font-bold text-emerald-950">{totals.settled}</p></div>
        <div className="rounded-lg bg-red-50 p-3 text-center"><p className="text-[10px] text-red-700">Due</p><p className="mt-1 text-sm font-bold tabular-nums text-red-950">{formatBDT(totals.due)}</p></div>
        <div className="rounded-lg bg-blue-50 p-3 text-center"><p className="text-[10px] text-blue-700">Paid</p><p className="mt-1 text-lg font-bold text-blue-950">{recovery.toFixed(0)}%</p></div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200" data-horizontal-scroll>
        <table className="min-w-[720px] w-full text-xs">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2.5 text-left">Staff</th><th className="px-3 py-2.5 text-left">Department</th><th className="px-3 py-2.5 text-right">Commitment</th><th className="px-3 py-2.5 text-right">Paid</th><th className="px-3 py-2.5 text-right">Due</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((item) => (
              <tr key={item.staffId}>
                <td className="px-3 py-2.5"><p className="font-semibold text-slate-900">{item.fullName}</p><p className="mt-0.5 text-[10px] text-slate-500">{item.staffId} · {item.role}</p></td>
                <td className="px-3 py-2.5 text-slate-600">{item.department}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatBDT(item.salary)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatBDT(item.paidThisMonth)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-red-700">{formatBDT(item.remainingDue)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No staff in this filter.</td></tr>}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold"><tr><td colSpan={2} className="px-3 py-2.5">Total</td><td className="px-3 py-2.5 text-right tabular-nums">{formatBDT(totals.commitment)}</td><td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatBDT(totals.paid)}</td><td className="px-3 py-2.5 text-right tabular-nums text-red-700">{formatBDT(totals.due)}</td></tr></tfoot>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={exportCsv} className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100">Export CSV</button>
        <button type="button" onClick={printReport} className="min-h-11 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Print report</button>
      </div>
    </section>
  );
}
