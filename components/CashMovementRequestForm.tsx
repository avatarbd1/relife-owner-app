"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { requestCashMovement } from "@/app/(dashboard)/finance/operations/actions";

type MovementType = "Reception→Treasury" | "Treasury→Bank";

export default function CashMovementRequestForm({
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
    movementType: "Reception→Treasury" as MovementType,
    amount: "",
    witness: "",
    remarks: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.amount || !form.witness.trim()) {
      setError("Amount এবং witness name দিতে হবে।");
      return;
    }

    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount একটি valid সংখ্যা হতে হবে।");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const requestId = `CSH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = await requestCashMovement({
        department,
        movementType: form.movementType,
        amount,
        witness: form.witness.trim(),
        remarks: form.remarks.trim() || "Cash handover",
        requestId,
      });

      haptic("success");
      setSuccess(
        `Cash movement request submitted (#${result.id})`
      );
      setForm({
        movementType: "Reception→Treasury",
        amount: "",
        witness: "",
        remarks: "",
      });

      setTimeout(() => {
        onSuccess?.();
        router.refresh();
      }, 1500);
    } catch (err) {
      haptic("error");
      setError(
        err instanceof Error ? err.message : "Cash request ব্যর্থ হয়েছে"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-600">
          Movement Type *
        </label>
        <select
          value={form.movementType}
          onChange={(e) =>
            setForm({ ...form, movementType: e.target.value as MovementType })
          }
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="Reception→Treasury">Reception থেকে Treasury-তে</option>
          <option value="Treasury→Bank">Treasury থেকে Bank-এ</option>
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
          placeholder="Amount enter করুন"
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Staff Witness (হস্তান্তরকারী) *
        </label>
        <input
          type="text"
          value={form.witness}
          onChange={(e) => setForm({ ...form, witness: e.target.value })}
          placeholder="যে person cash দিচ্ছে তার নাম"
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">
          Remarks (optional)
        </label>
        <textarea
          value={form.remarks}
          onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          rows={2}
          placeholder="কোনো বিশেষ নোট থাকলে লিখুন"
          className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
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
        {loading ? "Submitting..." : "Request Cash Movement"}
      </button>
    </form>
  );
}
