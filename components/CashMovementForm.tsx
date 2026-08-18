"use client";

import { useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastContext";
import { haptic } from "@/lib/interactions";
import { formatBDT } from "@/lib/format";
import type { Scope } from "@/lib/types";

type MovementType = "reception_to_treasury" | "treasury_to_bank" | "bank_to_reception";

interface CashMovementFormProps {
  scope: Scope;
  context: any;
}

export default function CashMovementForm({ scope, context }: CashMovementFormProps) {
  const { addToast } = useToastContext();
  const [busy, setBusy] = useState(false);
  const [movementType, setMovementType] = useState<MovementType>("reception_to_treasury");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const movements: Record<MovementType, { label: string; from: string; to: string }> = {
    reception_to_treasury: { label: "Reception → Treasury", from: "Reception", to: "Treasury" },
    treasury_to_bank: { label: "Treasury → Bank", from: "Treasury", to: "Bank" },
    bank_to_reception: { label: "Bank → Reception", from: "Bank", to: "Reception" },
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !note) {
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

      // Call server action to create cash movement
      const response = await fetch("/api/finance/cash/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movementType,
          amount: numAmount,
          note,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit cash movement request");
      }

      addToast("Cash movement request submitted for acceptance", "success");
      haptic("success");
      setAmount("");
      setNote("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit request";
      addToast(message, "error");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  const movement = movements[movementType];

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Movement Type *
          </label>
          <div className="mt-3 space-y-2">
            {(Object.entries(movements) as [MovementType, any][]).map(([type, { label }]) => (
              <label key={type} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="movement"
                  value={type}
                  checked={movementType === type}
                  onChange={() => setMovementType(type)}
                  disabled={busy}
                  className="cursor-pointer"
                />
                <span className="text-sm font-medium text-slate-800">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">From</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{movement.from}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">To</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{movement.to}</p>
            </div>
          </div>
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

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reason / Note *
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="Why is this cash movement needed?"
            rows={3}
            className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
          />
        </div>

        {amount && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[11px] font-semibold text-amber-600">Amount to Transfer</p>
            <p className="mt-1 text-lg font-bold text-amber-900">{formatBDT(parseFloat(amount) || 0)}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy && <Spinner size="xs" className="border-white/30 border-t-white" />}
          {busy ? "Submitting..." : "Request Cash Movement"}
        </button>

        <p className="text-[11px] text-slate-500">
          Owner will receive this request and can accept or reject. Cash position will be updated once accepted.
        </p>
      </div>
    </form>
  );
}
