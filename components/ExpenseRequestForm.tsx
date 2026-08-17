"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { requestExpense } from "@/app/(dashboard)/finance/operations/actions";

const EXPENSE_CATEGORIES = [
  "Medical & Supplies",
  "Equipment",
  "Maintenance",
  "Transport",
  "Utility",
  "Staff Training",
  "Marketing",
  "Other",
];

export default function ExpenseRequestForm({
  department,
  onSuccess,
}: {
  department: "Physio" | "Dental";
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    category: "",
    amount: "",
    note: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category || !form.amount || !form.note.trim()) {
      setError("সব field ভরতে হবে।");
      return;
    }

    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount একটি valid সংখ্যা হতে হবে।");
      return;
    }

    if (amount > 100000) {
      setError("Amount ১ লক্ষ টাকার বেশি হতে পারবে না।");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const requestId = `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = await requestExpense({
        department,
        category: form.category,
        amount,
        note: form.note.trim(),
        requestId,
      });

      haptic("success");
      setSuccess(`Expense request submitted successfully (#${result.id})`);
      setForm({ category: "", amount: "", note: "" });

      setTimeout(() => {
        onSuccess?.();
        router.refresh();
      }, 1500);
    } catch (err) {
      haptic("error");
      setError(
        err instanceof Error ? err.message : "Expense request ব্যর্থ হয়েছে"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Category *
        </label>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Select category...</option>
          {EXPENSE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

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
          max="100000"
          step="1"
          placeholder="Amount enter করুন"
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Description / Receipt details *
        </label>
        <textarea
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          rows={3}
          placeholder="কি জন্য এই expense? Receipt থাকলে number লিখুন।"
          className="mt-1 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
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
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {loading && <Spinner size="sm" className="border-white/30 border-t-white" />}
        {loading ? "Submitting..." : "Submit Expense Request"}
      </button>
    </form>
  );
}
