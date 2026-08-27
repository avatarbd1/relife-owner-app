"use client";

import { useMemo, useState } from "react";
import { InlineNotice, StatusBadge } from "@/components/FeedbackUI";

type Department = "Physio" | "Dental";
type Kind = "daily-collection" | "collection-history" | "expense-history" | "cash-history" | "salary-history" | "audit";
type Preset = "all" | "today" | "week" | "month" | "custom";

type Snapshot = {
  today: string;
  scope: "combined" | "physio" | "dental";
  collections: Array<{ receiptNo: string; date: string; patientId: string; patientName: string; department: Department; amount: number; discount: number; due: number; method: string; receivedBy: string }>;
  expenses: Array<{ expenseId: string; date: string; department: Department; category: string; description: string; amount: number; status: string; expenseType: string; paidFrom: string; paidBy: string; paidAt: string; isHouseholdWithdrawal: boolean }>;
  cashMovements: Array<{ id: string; date: string; department: Department; fromCustodian: string; toCustodian: string; amount: number; receivedAmount?: number; status: string; remarks: string }>;
  salaryPayments: Array<{ id: string; date: string; department: Department; staffId: string; staffName: string; amount: number; type: string; paidFrom: string; status: string; paidAt: string }>;
  capabilities: { receptionLimited: boolean; collections: boolean; expenses: boolean; cash: boolean; salary: boolean; audit: boolean };
};

type AuditRow = {
  key: string;
  type: "Collection" | "Expense" | "Cash" | "Salary";
  date: string;
  department: Department;
  title: string;
  detail: string;
  amount: number;
  status: string;
};

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

function tone(status: string): "success" | "warning" | "error" | "info" {
  const value = status.toLowerCase();
  if (["paid", "approved", "accepted", "completed", "collected"].includes(value)) return "success";
  if (["rejected", "cancelled", "canceled", "failed"].includes(value)) return "error";
  if (["pending", "requested", "approved_pending_payment"].includes(value)) return "warning";
  return "info";
}

function shiftDate(date: string, days: number): string {
  const ref = new Date(`${date}T12:00:00Z`);
  ref.setUTCDate(ref.getUTCDate() + days);
  return ref.toISOString().slice(0, 10);
}

function dateMatches(date: string, preset: Preset, today: string, from: string, to: string): boolean {
  if (preset === "all") return true;
  if (preset === "today") return date === today;
  if (preset === "week") return date >= shiftDate(today, -6) && date <= today;
  if (preset === "month") return date.startsWith(today.slice(0, 7));
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

const controlClass = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-400";

export default function FinanceLedgerClient({ kind, snapshot }: { kind: Kind; snapshot: Snapshot }) {
  const [preset, setPreset] = useState<Preset>(kind === "daily-collection" ? "today" : "month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [department, setDepartment] = useState<"all" | Department>("all");
  const [secondary, setSecondary] = useState("all");
  const [query, setQuery] = useState("");

  const auditRows = useMemo<AuditRow[]>(() => [
    ...snapshot.collections.map((row) => ({
      key: `payment-${row.department}-${row.receiptNo}`,
      type: "Collection" as const,
      date: row.date,
      department: row.department,
      title: row.patientName || row.patientId,
      detail: `${row.receiptNo} · ${row.method} · ${row.receivedBy || "collector unknown"}`,
      amount: row.amount,
      status: "Collected",
    })),
    ...snapshot.expenses.map((row) => ({
      key: `expense-${row.department}-${row.expenseId}`,
      type: "Expense" as const,
      date: row.date,
      department: row.department,
      title: row.category || row.expenseType,
      detail: `${row.expenseId}${row.paidFrom ? ` · From ${row.paidFrom}` : ""}`,
      amount: row.amount,
      status: row.status,
    })),
    ...snapshot.cashMovements.map((row) => ({
      key: `cash-${row.department}-${row.id}`,
      type: "Cash" as const,
      date: row.date,
      department: row.department,
      title: `${row.fromCustodian} → ${row.toCustodian}`,
      detail: row.id,
      amount: row.amount,
      status: row.status,
    })),
    ...snapshot.salaryPayments.map((row) => ({
      key: `salary-${row.department}-${row.id}`,
      type: "Salary" as const,
      date: row.date,
      department: row.department,
      title: row.staffName || row.staffId,
      detail: `${row.id} · ${row.type}${row.paidFrom ? ` · ${row.paidFrom}` : ""}`,
      amount: row.amount,
      status: row.status,
    })),
  ].sort((a, b) => `${b.date}|${b.key}`.localeCompare(`${a.date}|${a.key}`)), [snapshot]);

  const departments = useMemo(() => {
    const values = new Set<Department>();
    snapshot.collections.forEach((row) => values.add(row.department));
    snapshot.expenses.forEach((row) => values.add(row.department));
    snapshot.cashMovements.forEach((row) => values.add(row.department));
    snapshot.salaryPayments.forEach((row) => values.add(row.department));
    return [...values];
  }, [snapshot]);

  const secondaryOptions = useMemo(() => {
    const values = new Set<string>();
    if (kind === "daily-collection" || kind === "collection-history") snapshot.collections.forEach((row) => values.add(row.method));
    if (kind === "expense-history") snapshot.expenses.forEach((row) => values.add(row.status));
    if (kind === "cash-history") snapshot.cashMovements.forEach((row) => values.add(row.status));
    if (kind === "salary-history") snapshot.salaryPayments.forEach((row) => values.add(row.status));
    if (kind === "audit") ["Collection", "Expense", "Cash", "Salary"].forEach((value) => values.add(value));
    return [...values].filter(Boolean).sort();
  }, [kind, snapshot, auditRows]);

  const normalizedQuery = query.trim().toLowerCase();
  const common = (date: string, dept: Department, haystack: string) =>
    dateMatches(date, preset, snapshot.today, from, to) &&
    (department === "all" || department === dept) &&
    (!normalizedQuery || haystack.toLowerCase().includes(normalizedQuery));

  const collections = snapshot.collections.filter((row) =>
    common(row.date, row.department, `${row.receiptNo} ${row.patientId} ${row.patientName} ${row.method} ${row.receivedBy}`) &&
    (secondary === "all" || row.method === secondary)
  );
  const expenses = snapshot.expenses.filter((row) =>
    common(row.date, row.department, `${row.expenseId} ${row.category} ${row.description} ${row.status} ${row.paidFrom} ${row.paidBy}`) &&
    (secondary === "all" || row.status === secondary)
  );
  const cash = snapshot.cashMovements.filter((row) =>
    common(row.date, row.department, `${row.id} ${row.fromCustodian} ${row.toCustodian} ${row.status} ${row.remarks}`) &&
    (secondary === "all" || row.status === secondary)
  );
  const salary = snapshot.salaryPayments.filter((row) =>
    common(row.date, row.department, `${row.id} ${row.staffId} ${row.staffName} ${row.type} ${row.status} ${row.paidFrom}`) &&
    (secondary === "all" || row.status === secondary)
  );
  const audit = auditRows.filter((row) =>
    common(row.date, row.department, `${row.type} ${row.title} ${row.detail} ${row.status}`) &&
    (secondary === "all" || row.type === secondary)
  );

  const collectionTotal = collections.reduce((sum, row) => sum + row.amount, 0);
  const collectionCash = collections.filter((row) => row.method.toLowerCase() === "cash").reduce((sum, row) => sum + row.amount, 0);
  const expenseTotal = expenses.reduce((sum, row) => sum + row.amount, 0);
  const cashTotal = cash.reduce((sum, row) => sum + row.amount, 0);
  const salaryTotal = salary.reduce((sum, row) => sum + row.amount, 0);

  const secondaryLabel = kind === "daily-collection" || kind === "collection-history" ? "Method" : kind === "audit" ? "Ledger" : "Status";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Date">
            <select className={controlClass} value={preset} onChange={(event) => setPreset(event.target.value as Preset)} disabled={kind === "daily-collection"}>
              {kind === "daily-collection" && <option value="today">Today</option>}
              {kind !== "daily-collection" && <><option value="month">This month</option><option value="week">Last 7 days</option><option value="today">Today</option><option value="all">All time</option><option value="custom">Custom</option></>}
            </select>
          </Field>
          <Field label="Department">
            <select className={controlClass} value={department} onChange={(event) => setDepartment(event.target.value as "all" | Department)}>
              <option value="all">All visible</option>
              {departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label={secondaryLabel}>
            <select className={controlClass} value={secondary} onChange={(event) => setSecondary(event.target.value)}>
              <option value="all">All</option>
              {secondaryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Search">
            <input className={controlClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, patient, staff…" />
          </Field>
        </div>
        {preset === "custom" && kind !== "daily-collection" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className={controlClass} value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="To"><input type="date" className={controlClass} value={to} onChange={(event) => setTo(event.target.value)} /></Field>
          </div>
        )}
      </section>

      {(kind === "daily-collection" || kind === "collection-history") && (
        <>
          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-blue-50 p-3 ring-1 ring-blue-100"><p className="text-[10px] text-blue-700">Collected</p><p className="mt-1 text-base font-bold text-blue-950">{bdt(collectionTotal)}</p></div>
            <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100"><p className="text-[10px] text-emerald-700">Cash</p><p className="mt-1 text-base font-bold text-emerald-950">{bdt(collectionCash)}</p></div>
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100"><p className="text-[10px] text-slate-500">Receipts</p><p className="mt-1 text-base font-bold text-slate-950">{collections.length}</p></div>
          </section>
          <section className="space-y-2">
            {collections.map((row) => <article key={`${row.department}-${row.receiptNo}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.patientName || row.patientId}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.receiptNo} · {row.department} · {row.date}</p></div><strong className="text-sm tabular-nums text-emerald-700">{bdt(row.amount)}</strong></div><div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone="success">Collected</StatusBadge><StatusBadge tone="info">{row.method}</StatusBadge></div><p className="mt-2 text-[11px] text-slate-500">Collector: {row.receivedBy || "—"}{row.discount ? ` · Discount ${bdt(row.discount)}` : ""} · Due after receipt {bdt(row.due)}</p></article>)}
            {collections.length === 0 && <InlineNotice tone="neutral">এই filter-এ collection record নেই।</InlineNotice>}
          </section>
        </>
      )}

      {kind === "expense-history" && (
        <><section className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-100"><p className="text-[10px] text-amber-700">Visible amount</p><p className="mt-1 text-base font-bold text-amber-950">{bdt(expenseTotal)}</p></div><div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100"><p className="text-[10px] text-slate-500">Records</p><p className="mt-1 text-base font-bold">{expenses.length}</p></div></section><section className="space-y-2">{expenses.map((row) => <article key={`${row.department}-${row.expenseId}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{row.category || row.expenseType}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.expenseId} · {row.department} · {row.date}</p></div><strong className="text-sm">{bdt(row.amount)}</strong></div><div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge>{row.isHouseholdWithdrawal && <StatusBadge tone="info">Household</StatusBadge>}</div>{row.description && <p className="mt-2 text-xs text-slate-600">{row.description}</p>}<p className="mt-1 text-[10px] text-slate-400">{row.paidFrom ? `From ${row.paidFrom}` : "Not paid yet"}{row.paidBy ? ` · By ${row.paidBy}` : ""}</p></article>)}{expenses.length === 0 && <InlineNotice tone="neutral">এই filter-এ expense record নেই।</InlineNotice>}</section></>
      )}

      {kind === "cash-history" && (
        <><section className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-100"><p className="text-[10px] text-sky-700">Movement amount</p><p className="mt-1 text-base font-bold text-sky-950">{bdt(cashTotal)}</p></div><div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100"><p className="text-[10px] text-slate-500">Records</p><p className="mt-1 text-base font-bold">{cash.length}</p></div></section><section className="space-y-2">{cash.map((row) => { const discrepancy = row.receivedAmount !== undefined && Math.abs(row.receivedAmount - row.amount) > 0.009; return <article key={`${row.department}-${row.id}`} className={`rounded-xl border bg-white p-3 shadow-sm ${discrepancy ? "border-amber-300" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{row.fromCustodian} → {row.toCustodian}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.id} · {row.department} · {row.date}</p></div><strong className="text-sm">{bdt(row.amount)}</strong></div><div className="mt-2 flex gap-2"><StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge>{discrepancy && <StatusBadge tone="warning">Discrepancy</StatusBadge>}</div>{row.receivedAmount !== undefined && <p className="mt-2 text-xs text-slate-600">Actual received: {bdt(row.receivedAmount)}</p>}{row.remarks && <p className="mt-1 text-xs text-slate-500">{row.remarks}</p>}</article>; })}{cash.length === 0 && <InlineNotice tone="neutral">এই filter-এ cash handover record নেই।</InlineNotice>}</section></>
      )}

      {kind === "salary-history" && (
        <><section className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100"><p className="text-[10px] text-emerald-700">Payroll amount</p><p className="mt-1 text-base font-bold text-emerald-950">{bdt(salaryTotal)}</p></div><div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100"><p className="text-[10px] text-slate-500">Records</p><p className="mt-1 text-base font-bold">{salary.length}</p></div></section><section className="space-y-2">{salary.map((row) => <article key={`${row.department}-${row.id}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{row.staffName || row.staffId}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.id} · {row.department} · {row.date} · {row.type}</p></div><strong className="text-sm">{bdt(row.amount)}</strong></div><div className="mt-2"><StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge></div><p className="mt-1 text-[10px] text-slate-400">{row.paidFrom || "—"}{row.paidAt ? ` · ${row.paidAt}` : ""}</p></article>)}{salary.length === 0 && <InlineNotice tone="neutral">এই filter-এ salary record নেই।</InlineNotice>}</section></>
      )}

      {kind === "audit" && (
        <section className="space-y-2">
          {audit.map((row) => <article key={row.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone="info">{row.type}</StatusBadge><StatusBadge tone={tone(row.status)}>{row.status}</StatusBadge></div><p className="mt-2 truncate text-sm font-semibold">{row.title}</p><p className="mt-0.5 text-[11px] text-slate-500">{row.detail} · {row.department} · {row.date}</p></div><strong className="text-sm">{bdt(row.amount)}</strong></div></article>)}
          {audit.length === 0 && <InlineNotice tone="neutral">এই filter-এ finance activity নেই।</InlineNotice>}
        </section>
      )}
    </div>
  );
}
