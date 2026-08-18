"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastProvider";
import { formatBDT } from "@/lib/format";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

const CATEGORIES = [
  "Supplies & Materials",
  "Equipment",
  "Maintenance & Repairs",
  "Utilities & Services",
  "Staff Travel",
  "Professional Development",
  "Medical Waste",
  "Other",
];

export default function ExpenseRequestForm({ departments }: { departments: Department[] }) {
  const toast = useToastContext();
  const requestIdRef = useRef("");
  const [department, setDepartment] = useState<Department>(departments[0] || "Physio");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    requestIdRef.current = "";
  }, [department, category, amount, note]);

  function requestId(): string {
    if (!requestIdRef.current) {
      requestIdRef.current = `EXPREQ_${window.crypto.randomUUID().replace(/-/g, "")}`;
    }
    return requestIdRef.current;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const numericAmount = Number(amount);
    if (!category || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error("Category and a valid positive amount are required");
      return;
    }

    setBusy(true);
    haptic("tap");
    try {
      const response = await fetch("/api/finance/expense/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          department,
          category,
          amount: numericAmount,
          note,
          expenseType: "Clinic Expense",
          requestId: requestId(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Expense request failed");
      toast.success(payload.duplicate ? "Expense request already recorded" : "Expense request submitted");
      haptic("success");
      requestIdRef.current = "";
      setCategory("");
      setAmount("");
      setNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Expense request failed");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Expense request form">
      <div className="space-y-4">
        {departments.length > 1 && (
          <div>
            <label htmlFor="expense-department" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department</label>
            <select id="expense-department" value={department} onChange={(event) => setDepartment(event.target.value as Department)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
              {departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="expense-category" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</label>
          <select id="expense-category" required value={category} onChange={(event) => setCategory(event.target.value)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
            <option value="">Select category</option>
            {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="expense-amount" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount (BDT)</label>
          <input id="expense-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          {Number(amount) > 0 && <p className="mt-1 text-xs font-semibold text-blue-800">{formatBDT(Number(amount))}</p>}
        </div>

        <div>
          <label htmlFor="expense-note" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Note</label>
          <textarea id="expense-note" rows={4} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" placeholder="What is this expense for?" />
        </div>

        <button type="submit" disabled={busy || departments.length === 0} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
          {busy && <Spinner size="sm" className="border-white/30 border-t-white" />}
          {busy ? "Submitting…" : "Submit expense request"}
        </button>
        <p className="text-xs text-slate-500">The request enters the existing Pending → Owner decision → Pay workflow. Receipt attachment is not stored by this form.</p>
      </div>
    </form>
  );
}
