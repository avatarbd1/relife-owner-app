"use client";

import { useState } from "react";
import { InlineNotice, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";
type Tab = "expenses" | "cash" | "salary";
type Snapshot = {
  expenses: Array<{ expenseId: string; date: string; department: Department; category: string; description: string; amount: number; status: string; expenseType: string; paidFrom: string; paidBy: string; paidAt: string; isHouseholdWithdrawal: boolean }>;
  rejectedExpenses: Array<{ expenseId: string }>;
  cashMovements: Array<{ id: string; date: string; department: Department; fromCustodian: string; toCustodian: string; amount: number; receivedAmount?: number; status: string; remarks: string }>;
  salaryPayments: Array<{ id: string; date: string; department: Department; staffId: string; staffName: string; amount: number; type: string; paidFrom: string; status: string; paidAt: string }>;
  capabilities: { receptionLimited: boolean; expenseHistory: boolean; cashHistory: boolean; salaryHistory: boolean };
};

type Cash = { reception: number; homeTreasury: number; bank: number; total: number } | null;

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

function tone(status: string): "success" | "warning" | "error" | "info" {
  const value = status.toLowerCase();
  if (["paid", "approved", "accepted", "completed"].includes(value)) return "success";
  if (["rejected", "cancelled", "canceled", "failed"].includes(value)) return "error";
  if (["pending", "requested", "approved_pending_payment"].includes(value)) return "warning";
  return "info";
}

export default function FinanceHistoryClient({ snapshot, cashPosition }: { snapshot: Snapshot; cashPosition: Cash }) {
  const tabs: Tab[] = [
    ...(snapshot.capabilities.expenseHistory ? ["expenses" as const] : []),
    ...(snapshot.capabilities.cashHistory ? ["cash" as const] : []),
    ...(snapshot.capabilities.salaryHistory ? ["salary" as const] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0] || "expenses");

  return (
    <div className="space-y-4">
      {cashPosition && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Cash position</h2><p className="mt-0.5 text-xs text-slate-500">Accepted transfers only</p></div><strong className="text-lg tabular-nums text-slate-950">{bdt(cashPosition.total)}</strong></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-blue-50 p-2"><p className="text-[10px] text-blue-700">Reception</p><p className="mt-1 text-xs font-bold text-blue-950">{bdt(cashPosition.reception)}</p></div>
            <div className="rounded-lg bg-emerald-50 p-2"><p className="text-[10px] text-emerald-700">Treasury</p><p className="mt-1 text-xs font-bold text-emerald-950">{bdt(cashPosition.homeTreasury)}</p></div>
            <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Bank</p><p className="mt-1 text-xs font-bold text-slate-950">{bdt(cashPosition.bank)}</p></div>
          </div>
        </section>
      )}

      {tabs.length === 0 ? (
        <InlineNotice tone="neutral">এই account-এর জন্য finance history access নেই।</InlineNotice>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-horizontal-scroll>
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Finance history">
            {tabs.map((item) => (
              <button key={item} type="button" onClick={() => { setTab(item); haptic("tap"); }} className={`min-h-11 rounded-lg px-4 text-xs font-semibold capitalize ${tab === item ? "bg-blue-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{item}</button>
            ))}
          </div>
        </div>
      )}

      {tab === "expenses" && snapshot.capabilities.expenseHistory && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">{snapshot.capabilities.receptionLimited ? "Reception-paid expenses" : "Expense ledger"}</h2><p className="mt-0.5 text-xs text-slate-500">Request / approval / payment status evidence</p></div><StatusBadge tone={snapshot.rejectedExpenses.length ? "warning" : "info"}>{snapshot.expenses.length} records</StatusBadge></div>
          <div className="mt-3 space-y-2">
            {snapshot.expenses.slice(0, 150).map((item) => (
              <article key={`${item.department}-${item.expenseId}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.category || item.expenseType}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.expenseId} · {item.department} · {item.date}</p></div><strong className="text-sm tabular-nums text-slate-900">{bdt(item.amount)}</strong></div>
                <div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone={tone(item.status)}>{item.status}</StatusBadge>{item.isHouseholdWithdrawal && <StatusBadge tone="info">Household</StatusBadge>}</div>
                {item.description && <p className="mt-2 text-xs leading-5 text-slate-600">{item.description}</p>}
                {(item.paidFrom || item.paidBy) && <p className="mt-1 text-[10px] text-slate-400">{item.paidFrom ? `From ${item.paidFrom}` : ""}{item.paidBy ? ` · By ${item.paidBy}` : ""}</p>}
              </article>
            ))}
            {snapshot.expenses.length === 0 && <InlineNotice tone="neutral">Expense history নেই।</InlineNotice>}
          </div>
        </section>
      )}

      {tab === "cash" && snapshot.capabilities.cashHistory && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Cash handover ledger</h2><p className="mt-0.5 text-xs text-slate-500">Internal transfer — never business expense</p></div><StatusBadge tone="info">{snapshot.cashMovements.length} records</StatusBadge></div>
          <div className="mt-3 space-y-2">
            {snapshot.cashMovements.slice(0, 150).map((item) => {
              const discrepancy = item.receivedAmount !== undefined && Math.abs(item.receivedAmount - item.amount) > 0.009;
              return (
                <article key={`${item.department}-${item.id}`} className={`rounded-lg border p-3 ${discrepancy ? "border-amber-300 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{item.fromCustodian} → {item.toCustodian}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.department} · {item.date}</p></div><strong className="text-sm tabular-nums text-slate-900">{bdt(item.amount)}</strong></div>
                  <div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone={tone(item.status)}>{item.status}</StatusBadge>{discrepancy && <StatusBadge tone="warning">Discrepancy</StatusBadge>}</div>
                  {item.receivedAmount !== undefined && <p className={`mt-2 text-xs ${discrepancy ? "font-semibold text-amber-800" : "text-slate-500"}`}>Actual received: {bdt(item.receivedAmount)}</p>}
                  {item.remarks && <p className="mt-1 text-xs text-slate-600">{item.remarks}</p>}
                </article>
              );
            })}
            {snapshot.cashMovements.length === 0 && <InlineNotice tone="neutral">Cash movement history নেই।</InlineNotice>}
          </div>
        </section>
      )}

      {tab === "salary" && snapshot.capabilities.salaryHistory && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Salary ledger</h2><p className="mt-0.5 text-xs text-slate-500">Authorized payroll and advance evidence</p></div><StatusBadge tone="info">{snapshot.salaryPayments.length} records</StatusBadge></div>
          <div className="mt-3 space-y-2">
            {snapshot.salaryPayments.slice(0, 150).map((item) => (
              <article key={`${item.department}-${item.id}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.staffName || item.staffId}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.department} · {item.date} · {item.type}</p><div className="mt-2"><StatusBadge tone={tone(item.status)}>{item.status}</StatusBadge></div><p className="mt-1 text-[10px] text-slate-400">{item.paidFrom}{item.paidAt ? ` · ${item.paidAt}` : ""}</p></div>
                <strong className="text-sm tabular-nums text-slate-900">{bdt(item.amount)}</strong>
              </article>
            ))}
            {snapshot.salaryPayments.length === 0 && <InlineNotice tone="neutral">Salary history নেই।</InlineNotice>}
          </div>
        </section>
      )}
    </div>
  );
}
