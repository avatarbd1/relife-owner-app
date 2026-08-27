"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { useToastContext } from "@/components/ToastProvider";

type Department = "Physio" | "Dental";

export interface BulkExpenseApprovalItem {
  expenseId: string;
  department: Department;
  date: string;
  category: string;
  description: string;
  amount: number;
}

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

export default function BulkExpenseApproval({
  items,
}: {
  items: BulkExpenseApprovalItem[];
}) {
  const router = useRouter();
  const toast = useToastContext();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const selectedItems = useMemo(
    () =>
      items
        .filter((item) => selected.has(`${item.department}:${item.expenseId}`))
        .sort((a, b) => `${a.date}:${a.expenseId}`.localeCompare(`${b.date}:${b.expenseId}`)),
    [items, selected]
  );
  const total = selectedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    haptic("tap");
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((item) => `${item.department}:${item.expenseId}`)));
    haptic("tap");
  }

  async function decide(decision: "approve" | "reject") {
    if (busy || selectedItems.length === 0) return;
    if (!pin.trim()) {
      toast.warning("Owner PIN required");
      haptic("error");
      return;
    }
    if (decision === "reject" && reason.trim().length < 3) {
      toast.warning("Rejection reason required");
      haptic("error");
      return;
    }

    setBusy(decision);
    let success = 0;
    const failed: string[] = [];
    const succeededKeys: string[] = [];

    for (const item of selectedItems) {
      try {
        const response = await fetch("/api/control/expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workbook: item.department === "Dental" ? "dental" : "physio",
            id: item.expenseId,
            decision,
            pin,
            reason: decision === "reject" ? reason.trim() : undefined,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : `HTTP_${response.status}`);
        }
        success += 1;
        succeededKeys.push(`${item.department}:${item.expenseId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Decision failed";
        failed.push(`${item.expenseId}: ${message}`);
      }
    }

    if (succeededKeys.length) {
      setSelected((current) => {
        const next = new Set(current);
        succeededKeys.forEach((key) => next.delete(key));
        return next;
      });
    }

    setPin("");
    if (decision === "reject" && success > 0) setReason("");
    if (failed.length === 0) {
      toast.success(`${success} expense${success === 1 ? "" : "s"} ${decision === "approve" ? "approved" : "rejected"}`);
      haptic("success");
    } else if (success > 0) {
      toast.warning(`${success} completed, ${failed.length} failed · ${failed.slice(0, 2).join(" · ")}`);
      haptic("warning");
    } else {
      toast.error(failed[0] || "No expense was updated");
      haptic("error");
    }
    setBusy(null);
    router.refresh();
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">Owner approvals</p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">Batch pending expenses</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Every selected item still goes through the existing PIN-protected approval API and audit path.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{items.length}</span>
      </div>

      <label className="mt-3 flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-amber-100">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} />
        Select all
        {selectedItems.length > 0 && <span className="ml-auto tabular-nums">{selectedItems.length} · {bdt(total)}</span>}
      </label>

      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {items.map((item) => {
          const key = `${item.department}:${item.expenseId}`;
          return (
            <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-100 bg-white p-3">
              <input className="mt-1" type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900">{item.category || item.description || item.expenseId}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{item.expenseId} · {item.department} · {item.date}</p>
                {item.description && <p className="mt-1 text-[11px] text-slate-600">{item.description}</p>}
              </div>
              <strong className="shrink-0 text-xs tabular-nums text-slate-900">{bdt(item.amount)}</strong>
            </label>
          );
        })}
      </div>

      {selectedItems.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="Owner PIN"
            className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
          />
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="Rejection reason (required only for Reject)"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide("approve")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "approve" && <Spinner size="sm" className="border-white/30 border-t-white" label="Approving" />}
              Approve {selectedItems.length}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide("reject")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "reject" && <Spinner size="sm" className="border-white/30 border-t-white" label="Rejecting" />}
              Reject {selectedItems.length}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
