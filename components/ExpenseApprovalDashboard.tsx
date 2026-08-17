"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { formatBDT } from "@/lib/format";
import { approveExpense, rejectExpense } from "@/app/(dashboard)/finance/operations/actions";

interface PendingExpense {
  id: string;
  date: string;
  category: string;
  amount: number;
  note: string;
  requestedBy: string;
  department: "Physio" | "Dental";
}

export default function ExpenseApprovalDashboard({
  pendingExpenses,
}: {
  pendingExpenses: PendingExpense[];
}) {
  const router = useRouter();
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleApprove(expense: PendingExpense) {
    setProcessing(expense.id);
    setError("");

    try {
      await approveExpense({
        department: expense.department,
        expenseId: expense.id,
      });

      haptic("success");
      setTimeout(() => {
        router.refresh();
      }, 500);
    } catch (err) {
      haptic("error");
      setError(
        err instanceof Error ? err.message : "Approval failed"
      );
      setProcessing(null);
    }
  }

  async function handleReject(expense: PendingExpense, reason: string) {
    if (!reason.trim()) {
      setError("Rejection reason দিতে হবে।");
      return;
    }

    setProcessing(expense.id);
    setError("");

    try {
      await rejectExpense({
        department: expense.department,
        expenseId: expense.id,
        reason,
      });

      haptic("success");
      setTimeout(() => {
        router.refresh();
      }, 500);
    } catch (err) {
      haptic("error");
      setError(
        err instanceof Error ? err.message : "Rejection failed"
      );
      setProcessing(null);
    }
  }

  if (pendingExpenses.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-500">
        No pending expense requests. সব clear!
      </div>
    );
  }

  const totalAmount = pendingExpenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
        <span className="text-sm font-semibold text-amber-900">
          {pendingExpenses.length} pending request{pendingExpenses.length > 1 ? "s" : ""} · {formatBDT(totalAmount)} total
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {pendingExpenses.map((expense) => (
          <div
            key={expense.id}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {expense.category}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      expense.department === "Dental"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {expense.department}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {expense.date} · Requested by {expense.requestedBy}
                </p>
                <p className="mt-2 text-[11px] leading-4 text-slate-600">
                  {expense.note}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-bold text-slate-900">
                  {formatBDT(expense.amount)}
                </p>
              </div>
            </div>

            {/* Expand/Collapse Actions */}
            <div className="mt-3 space-y-2">
              {expandedId === expense.id ? (
                <>
                  <textarea
                    id={`reject-reason-${expense.id}`}
                    placeholder="Rejection reason (if rejecting)"
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-red-100"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(expense)}
                      disabled={processing === expense.id}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {processing === expense.id && (
                        <Spinner size="sm" className="border-white/30 border-t-white" />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        const reason = (
                          document.getElementById(
                            `reject-reason-${expense.id}`
                          ) as HTMLTextAreaElement
                        )?.value;
                        handleReject(expense, reason);
                      }}
                      disabled={processing === expense.id}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {processing === expense.id && (
                        <Spinner size="sm" className="border-white/30 border-t-white" />
                      )}
                      Reject
                    </button>
                    <button
                      onClick={() => setExpandedId(null)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setExpandedId(expense.id)}
                  className="w-full rounded-lg border border-amber-200 bg-amber-50 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                >
                  Approve or Reject
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
