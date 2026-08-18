"use client";

import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastContext";
import { haptic } from "@/lib/interactions";
import { formatBDT } from "@/lib/format";
import type { Scope } from "@/lib/types";

const EXPENSE_CATEGORIES = [
  "Supplies & Materials",
  "Equipment",
  "Maintenance & Repairs",
  "Utilities & Services",
  "Staff Travel",
  "Professional Development",
  "Medical Waste",
  "Other",
];

interface ExpenseRequestFormProps {
  scope: Scope;
  context: any;
}

export default function ExpenseRequestForm({ scope, context }: ExpenseRequestFormProps) {
  const { addToast } = useToastContext();
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [department, setDepartment] = useState<"Physio" | "Dental">("Physio");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !amount || !note) {
      addToast("Please fill in all required fields", "error");
      return;
    }

    setBusy(true);
    haptic("tap");

    try {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        addToast("Please enter a valid amount", "error");
        return;
      }

      // Call server action to create expense request
      const formData = new FormData();
      formData.append("category", category);
      formData.append("amount", String(numAmount));
      formData.append("note", note);
      formData.append("department", department);
      if (receipt) {
        formData.append("receipt", receipt);
      }

      const response = await fetch("/api/expense/request", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to submit expense request");
      }

      addToast("Expense request submitted successfully", "success");
      haptic("success");
      setCategory("");
      setAmount("");
      setNote("");
      setReceipt(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit expense request";
      addToast(message, "error");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Category *
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
            className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
          >
            <option value="">Select a category</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Department *
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as "Physio" | "Dental")}
              disabled={busy}
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            >
              <option value="Physio">Physio</option>
              <option value="Dental">Dental</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Amount (BDT) *
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              placeholder="0"
              step="0.01"
              min="0"
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Description / Note *
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="What is this expense for? Include details..."
            rows={4}
            className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Receipt / Evidence
          </label>
          <input
            type="file"
            onChange={(e) => setReceipt(e.target.files?.[0] || null)}
            disabled={busy}
            accept="image/*,.pdf"
            className="mt-2 block w-full text-sm text-slate-600 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
          />
          {receipt && (
            <p className="mt-2 text-xs text-slate-500">
              File selected: {receipt.name} ({(receipt.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {amount && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-[11px] font-semibold text-blue-600">Amount to Request</p>
            <p className="mt-1 text-lg font-bold text-blue-900">{formatBDT(parseFloat(amount) || 0)}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy && <Spinner size="xs" className="border-white/30 border-t-white" />}
          {busy ? "Submitting..." : "Submit Expense Request"}
        </button>

        <p className="text-[11px] text-slate-500">
          Your request will be reviewed by the clinic owner. You'll receive notification when approved or rejected.
        </p>
      </div>
    </form>
  );
}
