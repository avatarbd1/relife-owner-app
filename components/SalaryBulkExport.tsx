"use client";

import { useState } from "react";
import { formatBDT } from "@/lib/format";
import { haptic } from "@/lib/interactions";

interface StaffRow {
  staffId: string;
  fullName: string;
  salary: number;
  paidThisMonth: number;
  remainingDue: number;
  status: string;
  bankAccount?: string;
}

export default function SalaryBulkExport({
  staff,
  month,
}: {
  staff: StaffRow[];
  month: string;
}) {
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("active");

  const filteredStaff = staff.filter((s) => {
    if (filterStatus === "all") return true;
    return s.status.toLowerCase() === filterStatus;
  });

  const totalCommitment = filteredStaff.reduce((sum, s) => sum + s.salary, 0);
  const totalPaid = filteredStaff.reduce((sum, s) => sum + s.paidThisMonth, 0);
  const totalDue = filteredStaff.reduce((sum, s) => sum + s.remainingDue, 0);

  function handleExportCSV() {
    // Create CSV for bank transfer
    const headers = [
      "Staff ID",
      "Full Name",
      "Commitment",
      "Paid This Month",
      "Remaining Due",
      "Status",
    ];

    const rows = filteredStaff.map((s) => [
      s.staffId,
      s.fullName,
      s.salary,
      s.paidThisMonth,
      s.remainingDue,
      s.status,
    ]);

    // Add summary rows
    rows.push(["", "TOTAL", totalCommitment, totalPaid, totalDue, ""]);

    const csv = [
      `Salary Settlement Report - ${month}`,
      `Generated: ${new Date().toLocaleString("en-BD")}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      "",
      `Total Staff: ${filteredStaff.length}`,
      `Filter: ${filterStatus === "all" ? "All" : filterStatus === "active" ? "Active Only" : "Inactive Only"}`,
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `salary-${month}-${Date.now()}.csv`;
    link.click();

    haptic("success");
  }

  function handleExportPDF() {
    // Create a printable HTML version
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Salary Settlement Report - ${month}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { font-size: 24px; margin-bottom: 10px; }
          .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; font-weight: bold; }
          .summary { margin-top: 20px; font-size: 12px; }
          .total-row { background-color: #f9f9f9; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Salary Settlement Report</h1>
        <p class="meta">Month: ${month} | Generated: ${new Date().toLocaleString("en-BD")}</p>

        <table>
          <thead>
            <tr>
              <th>Staff ID</th>
              <th>Full Name</th>
              <th>Commitment</th>
              <th>Paid</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${filteredStaff
              .map(
                (s) => `
              <tr>
                <td>${s.staffId}</td>
                <td>${s.fullName}</td>
                <td>${s.salary}</td>
                <td>${s.paidThisMonth}</td>
                <td>${s.remainingDue}</td>
                <td>${s.status}</td>
              </tr>
            `
              )
              .join("")}
            <tr class="total-row">
              <td colspan="2">TOTAL</td>
              <td>${totalCommitment}</td>
              <td>${totalPaid}</td>
              <td>${totalDue}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <div class="summary">
          <p><strong>Total Staff:</strong> ${filteredStaff.length}</p>
          <p><strong>Filter:</strong> ${filterStatus === "all" ? "All" : filterStatus === "active" ? "Active Only" : "Inactive Only"}</p>
          <p style="margin-top: 30px;">_________________________</p>
          <p>Owner Signature</p>
        </div>
      </body>
      </html>
    `;

    const window_obj = window.open("", "", "width=800,height=600");
    if (window_obj) {
      window_obj.document.write(html);
      window_obj.document.close();
      window_obj.print();
    }
    haptic("success");
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">📊 Bulk Export & Reports</h3>
        <p className="mt-1 text-xs text-slate-500">
          Export salary data for bank transfers or print settlement reports
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">Filter by Status</label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          className="min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="all">All Staff</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3">
        <div className="text-center">
          <p className="text-[10px] text-slate-600">Total Commitment</p>
          <p className="mt-1 font-bold text-slate-900">{formatBDT(totalCommitment)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-600">Paid This Month</p>
          <p className="mt-1 font-bold text-emerald-700">{formatBDT(totalPaid)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-600">Total Due</p>
          <p className="mt-1 font-bold text-red-700">{formatBDT(totalDue)}</p>
        </div>
      </div>

      {/* Export Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleExportCSV}
          className="flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          📥 Export CSV
        </button>
        <button
          onClick={handleExportPDF}
          className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          🖨️ Print Report
        </button>
      </div>

      <p className="text-[10px] text-slate-500">
        CSV: Import into bank portal for bulk transfers  |  PDF: Print & sign for records
      </p>
    </div>
  );
}
