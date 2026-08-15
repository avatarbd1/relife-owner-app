"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { InlineNotice, ProgressBar, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";
type StaffItem = {
  staffId: string;
  fullName: string;
  role: string;
  department: Department;
  salary: number;
  status: "Active" | "Inactive";
  paidThisMonth: number;
  remainingDue: number;
};
type PaymentItem = {
  id: string;
  date: string;
  staffId: string;
  staffName: string;
  department: Department;
  amount: number;
  type: string;
  paidFrom?: string;
  status?: string;
};
type Tab = "active" | "inactive" | "summary";

function requestId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function cardTone(percent: number): string {
  if (percent >= 100) return "border-emerald-200 bg-emerald-50/70";
  if (percent > 75) return "border-emerald-200 bg-emerald-50/60";
  if (percent >= 50) return "border-amber-200 bg-amber-50/70";
  return "border-red-200 bg-red-50/60";
}

export default function SalaryManagementClient({
  staff,
  payments,
  canPay,
}: {
  staff: StaffItem[];
  payments: PaymentItem[];
  canPay: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("active");
  const [selected, setSelected] = useState<StaffItem | null>(null);
  const [amount, setAmount] = useState("");
  const [paidFrom, setPaidFrom] = useState<"Reception" | "Home Treasury" | "Bank">("Home Treasury");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [webRequestId, setWebRequestId] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const active = staff.filter((item) => item.status === "Active");
  const inactive = staff.filter((item) => item.status === "Inactive");
  const commitment = active.reduce((sum, item) => sum + item.salary, 0);
  const paid = active.reduce((sum, item) => sum + item.paidThisMonth, 0);
  const due = active.reduce((sum, item) => sum + item.remainingDue, 0);
  const paidPct = commitment > 0 ? (paid / commitment) * 100 : 0;
  const urgent = active.filter((item) => item.salary > 0 && item.paidThisMonth / item.salary < 0.34);

  const selectedHistory = useMemo(
    () => selected ? payments.filter((item) => item.staffId === selected.staffId).slice(0, 8) : [],
    [payments, selected]
  );

  function openPay(item: StaffItem) {
    setSelected(item);
    setAmount(String(item.remainingDue || item.salary || 0));
    setPaidFrom("Home Treasury");
    setNote("");
    setPin("");
    setMessage(null);
    setWebRequestId(requestId());
    haptic("tap");
  }

  async function paySalary() {
    if (!selected || !canPay || busy) return;
    if (!online) {
      setMessage("✕ Internet connection required for payroll writes");
      haptic("error");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/finance/salary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          staffId: selected.staffId,
          amount: Number(amount || 0),
          paidFrom,
          note,
          pin,
          requestId: webRequestId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "SALARY_PAY_FAILED");
      setMessage(`✓ Salary payment saved · ${String(payload.paymentId || "")}`);
      setSelected(null);
      setWebRequestId(requestId());
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage(`✕ ${error instanceof Error ? error.message : "Salary payment failed"}`);
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "active", label: `Active · ${active.length}` },
    { id: "inactive", label: `Inactive · ${inactive.length}` },
    { id: "summary", label: "Summary" },
  ];

  return (
    <div className="space-y-4">
      {!online && <InlineNotice tone="warning">Offline — payroll writes are disabled and never queued.</InlineNotice>}
      {message && <div className={message.startsWith("✓") ? "relife-success-flash" : "relife-error-shake"}><InlineNotice tone={message.startsWith("✓") ? "success" : "error"}>{message}</InlineNotice></div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-horizontal-scroll>
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Salary management tabs">
          {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); haptic("tap"); }} className={`min-h-11 rounded-lg px-4 text-xs font-semibold ${tab === item.id ? "bg-blue-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{item.label}</button>)}
        </div>
      </div>

      {tab === "active" && (
        <div className="relife-fade-in space-y-3">
          {active.map((item) => {
            const pct = item.salary > 0 ? Math.min(100, (item.paidThisMonth / item.salary) * 100) : 100;
            const staffHistory = payments.filter((row) => row.staffId === item.staffId).slice(0, 3);
            return (
              <article key={item.staffId} className={`rounded-xl border p-4 shadow-sm transition-colors duration-150 ${cardTone(pct)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="text-base font-semibold text-slate-950">{item.fullName}</h2><p className="mt-0.5 text-xs text-slate-500">{item.role} · {item.department} · {item.staffId}</p></div>
                  <StatusBadge tone={pct >= 100 ? "success" : pct >= 67 ? "info" : pct >= 34 ? "warning" : "error"}>{Math.round(pct)}% paid</StatusBadge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white/70 p-2"><p className="text-[10px] text-slate-500">Monthly</p><p className="mt-1 text-xs font-bold tabular-nums text-slate-950">{bdt(item.salary)}</p></div>
                  <div className="rounded-lg bg-white/70 p-2"><p className="text-[10px] text-emerald-700">Paid</p><p className="mt-1 text-xs font-bold tabular-nums text-emerald-900">{bdt(item.paidThisMonth)}</p></div>
                  <div className="rounded-lg bg-white/70 p-2"><p className="text-[10px] text-red-700">Remaining</p><p className="mt-1 text-xs font-bold tabular-nums text-red-900">{bdt(item.remainingDue)}</p></div>
                </div>
                <ProgressBar value={pct} label="This month paid" className="mt-4" />
                {staffHistory.length > 0 && <div className="mt-3 rounded-lg bg-white/60 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Recent payroll history</p><div className="mt-2 space-y-1">{staffHistory.map((row) => <p key={row.id} className="text-[11px] text-slate-600">• {row.date}: {bdt(row.amount)}{row.type ? ` · ${row.type}` : ""}{row.paidFrom ? ` · ${row.paidFrom}` : ""}</p>)}</div></div>}
                {canPay && item.remainingDue > 0 && <button type="button" onClick={() => openPay(item)} className="mt-3 min-h-11 w-full rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900">Pay {item.remainingDue >= item.salary ? "full salary" : `remaining ${bdt(item.remainingDue)}`}</button>}
              </article>
            );
          })}
          {active.length === 0 && <InlineNotice tone="neutral">Active salaried staff নেই।</InlineNotice>}
        </div>
      )}

      {tab === "inactive" && (
        <section className="relife-fade-in rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Inactive staff</h2>
          <div className="mt-3 space-y-2">{inactive.map((item) => <div key={item.staffId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><div><p className="text-sm font-semibold text-slate-900">{item.fullName}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.role} · {item.department} · {item.staffId}</p></div><StatusBadge tone="neutral">Inactive</StatusBadge></div>)}{inactive.length === 0 && <InlineNotice tone="neutral">Inactive staff নেই।</InlineNotice>}</div>
        </section>
      )}

      {tab === "summary" && (
        <div className="relife-fade-in space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">Payroll overview</h2><p className="mt-0.5 text-xs text-slate-500">Current month · active staff only</p></div><StatusBadge tone={due > 0 ? "warning" : "success"}>{Math.round(paidPct)}% paid</StatusBadge></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Commitment</p><p className="mt-1 text-sm font-bold tabular-nums">{bdt(commitment)}</p></div><div className="rounded-lg bg-emerald-50 p-3"><p className="text-[10px] text-emerald-700">Paid</p><p className="mt-1 text-sm font-bold tabular-nums text-emerald-900">{bdt(paid)}</p></div><div className="rounded-lg bg-red-50 p-3"><p className="text-[10px] text-red-700">Due</p><p className="mt-1 text-sm font-bold tabular-nums text-red-900">{bdt(due)}</p></div></div>
            <ProgressBar value={paidPct} label="Total payroll paid" className="mt-4" />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">Needs attention</h2><p className="mt-0.5 text-xs text-slate-500">Staff below 34% paid</p></div>{urgent.length > 0 && <StatusBadge tone="error">{urgent.length} urgent</StatusBadge>}</div>
            <div className="mt-3 space-y-2">{urgent.map((item) => <div key={item.staffId} className="flex items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-3"><div><p className="text-xs font-semibold text-red-950">{item.fullName}</p><p className="mt-0.5 text-[11px] text-red-700">{item.department} · {item.role}</p></div><strong className="text-xs tabular-nums text-red-900">{bdt(item.remainingDue)}</strong></div>)}{urgent.length === 0 && <InlineNotice tone="success">No staff below the urgent payroll threshold.</InlineNotice>}</div>
          </section>
          <InlineNotice tone="info" title="No unsafe bulk payroll">Each salary payment remains an individually PIN-confirmed, idempotent ledger write. Bulk “Pay All” is not exposed without an atomic backend transaction.</InlineNotice>
        </div>
      )}

      {selected && canPay && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-4 backdrop-blur-[1px] sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Pay salary">
          <div className="relife-page-enter w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">Pay {selected.fullName}</h2><p className="mt-0.5 text-xs text-slate-500">Remaining {bdt(selected.remainingDue)} · {selected.department}</p></div><StatusBadge tone="info">PIN protected</StatusBadge></div>
            <div className="mt-4 space-y-3">
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Amount</label><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Pay from</label><div className="grid grid-cols-3 gap-2">{(["Reception", "Home Treasury", "Bank"] as const).map((item) => <button key={item} type="button" onClick={() => setPaidFrom(item)} className={`min-h-11 rounded-lg border px-2 text-[11px] font-semibold ${paidFrom === item ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 text-slate-600"}`}>{item}</button>)}</div></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Note</label><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Salary / advance note" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Owner PIN</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => setSelected(null)} className="min-h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button type="button" disabled={busy || !online || !pin || Number(amount || 0) <= 0} onClick={paySalary} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-800 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none">{busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving salary" />}{busy ? "Saving…" : "Confirm payment"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
