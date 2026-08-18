"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { formatBDT } from "@/lib/format";
import { recordSalaryPayment } from "@/app/(dashboard)/salary/actions";

type PaidFrom = "Reception" | "Home Treasury" | "Bank";

export default function SalaryPaymentForm({
  staffId,
  staffName,
  department,
  commitment,
  paidThisMonth,
  onSuccess,
}: {
  staffId: string;
  staffName: string;
  department: "Physio" | "Dental";
  commitment: number;
  paidThisMonth: number;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const remaining = Math.max(0, commitment - paidThisMonth);

  const [form, setForm] = useState({
    amount: String(remaining),
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "Bank" as PaidFrom,
    notes: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount একটি valid সংখ্যা হতে হবে।");
      return;
    }

    if (amount > commitment) {
      setError(`Amount commitment (${formatBDT(commitment)}) এর বেশি হতে পারবে না।`);
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const result = await recordSalaryPayment({
        staffId,
        department,
        amount,
        paymentDate: form.paymentDate,
        paymentMethod: form.paymentMethod,
        notes: form.notes.trim() || "Salary payment",
      });

      haptic("success");
      setSuccess(`Payment recorded for ${staffName}: ${formatBDT(amount)}`);
      setForm({
        amount: String(remaining - amount),
        paymentDate: new Date().toISOString().split("T")[0],
        paymentMethod: "Bank",
        notes: "",
      });

      setTimeout(() => {
        onSuccess?.();
        router.refresh();
      }, 1500);
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Payment recording ব্যর্থ হয়েছে");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-900">{staffName}</label>
          <span className="text-xs text-slate-500">{department}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-blue-50 p-2">
            <p className="text-slate-600">Commitment</p>
            <p className="mt-1 font-bold text-blue-900">{formatBDT(commitment)}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2">
            <p className="text-slate-600">Paid</p>
            <p className="mt-1 font-bold text-emerald-900">{formatBDT(paidThisMonth)}</p>
          </div>
          <div className="rounded-lg bg-red-50 p-2">
            <p className="text-slate-600">Due</p>
            <p className="mt-1 font-bold text-red-900">{formatBDT(remaining)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Amount (টাকা) *
          </label>
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            inputMode="decimal"
            min="1"
            max={commitment}
            step="100"
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Payment Date *
          </label>
          <input
            type="date"
            value={form.paymentDate}
            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Payment Method *
        </label>
        <select
          value={form.paymentMethod}
          onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as PaidFrom })}
          className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="Reception">Reception</option>
          <option value="Home Treasury">Home Treasury</option>
          <option value="Bank">Bank Transfer</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Notes (optional)
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          placeholder="Payment reference, advance deducted, etc."
          className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {loading && <Spinner size="sm" className="border-white/30 border-t-white" />}
        {loading ? "Recording..." : `Record Payment ${formatBDT(parseFloat(form.amount) || 0)}`}
      </button>
    </form>
  );
}
