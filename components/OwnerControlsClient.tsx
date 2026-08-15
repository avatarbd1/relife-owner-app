"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type WorkbookView = "physio" | "dental";

type ExpenseView = {
  workbook: WorkbookView;
  id: string;
  date: string;
  category: string;
  amount: number;
  requestedBy: string;
  paidFrom: string;
  note: string;
  department: string;
};

type CashView = {
  workbook: WorkbookView;
  id: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  movedBy: string;
  note: string;
  department: string;
};

type Snapshot = {
  privateSheets: boolean;
  writeEnabled: boolean;
  pendingExpenses: ExpenseView[];
  pendingCashMovements: CashView[];
};

type PendingAction =
  | { kind: "expense"; decision: "approve" | "reject"; item: ExpenseView }
  | { kind: "cash"; decision: "accept" | "reject"; item: CashView };

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

function departmentPill(department: string) {
  return department === "Dental"
    ? "bg-sky-50 text-sky-700"
    : "bg-emerald-50 text-emerald-700";
}

export default function OwnerControlsClient({ snapshot }: { snapshot: Snapshot }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pin, setPin] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const pendingTotal =
    snapshot.pendingExpenses.length + snapshot.pendingCashMovements.length;
  const actionAmount = useMemo(() => {
    if (!pendingAction) return 0;
    return pendingAction.item.amount;
  }, [pendingAction]);

  function openAction(action: PendingAction) {
    setMessage("");
    setPin("");
    setReceivedAmount(
      action.kind === "cash" && action.decision === "accept"
        ? String(action.item.amount)
        : ""
    );
    setPendingAction(action);
  }

  async function submitAction() {
    if (!pendingAction || !pin) return;
    setBusy(true);
    setMessage("");

    const isExpense = pendingAction.kind === "expense";
    const payload: Record<string, unknown> = {
      workbook: pendingAction.item.workbook,
      id: pendingAction.item.id,
      decision: pendingAction.decision,
      pin,
    };
    if (!isExpense && pendingAction.decision === "accept") {
      payload.receivedAmount = Number(receivedAmount || pendingAction.item.amount);
    }

    try {
      const response = await fetch(
        isExpense ? "/api/control/expense" : "/api/control/cash-movement",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }
      setMessage("Saved successfully.");
      setPendingAction(null);
      setPin("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (pendingTotal === 0) {
    return (
      <div className="rounded-2xl bg-white px-4 py-5 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-900">No pending approvals</p>
        <p className="mt-1 text-xs text-slate-500">Expense and cash requests are up to date.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {snapshot.pendingExpenses.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Expense approvals</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Pending owner decision</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {snapshot.pendingExpenses.length}
            </span>
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {snapshot.pendingExpenses.map((item) => (
              <article key={`${item.workbook}-${item.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.category || item.id}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.date} · {item.requestedBy || "Unknown"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${departmentPill(item.department)}`}>
                    {item.department}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="truncate text-xs text-slate-500">From {item.paidFrom || "-"}</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-950">{bdt(item.amount)}</span>
                </div>
                {item.note && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.note}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    disabled={!snapshot.writeEnabled}
                    onClick={() => openAction({ kind: "expense", decision: "reject", item })}
                    className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-red-600 disabled:opacity-40"
                  >
                    Reject
                  </button>
                  <button
                    disabled={!snapshot.writeEnabled}
                    onClick={() => openAction({ kind: "expense", decision: "approve", item })}
                    className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Approve
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {snapshot.pendingCashMovements.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Cash handover</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Confirm actual amount received</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {snapshot.pendingCashMovements.length}
            </span>
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {snapshot.pendingCashMovements.map((item) => (
              <article key={`${item.workbook}-${item.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.from} → {item.to}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.date} · {item.movedBy || "Unknown"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${departmentPill(item.department)}`}>
                    {item.department}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Requested</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-950">{bdt(item.amount)}</span>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    disabled={!snapshot.writeEnabled}
                    onClick={() => openAction({ kind: "cash", decision: "reject", item })}
                    className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-red-600 disabled:opacity-40"
                  >
                    Reject
                  </button>
                  <button
                    disabled={!snapshot.writeEnabled}
                    onClick={() => openAction({ kind: "cash", decision: "accept", item })}
                    className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Accept
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {message && (
        <p className={`rounded-xl px-3 py-2 text-xs ${message.startsWith("Saved") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </p>
      )}

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Confirm action</h3>
            <p className="mt-1 text-xs text-slate-500">
              {pendingAction.item.id} · {bdt(actionAmount)} · {pendingAction.decision.toUpperCase()}
            </p>

            {pendingAction.kind === "cash" && pendingAction.decision === "accept" && (
              <label className="mt-4 block text-xs font-medium text-slate-600">
                Received amount
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={receivedAmount}
                  onChange={(event) => setReceivedAmount(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                />
              </label>
            )}

            <label className="mt-4 block text-xs font-medium text-slate-600">
              Owner PIN
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && pin && !busy) void submitAction();
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                placeholder="Enter PIN"
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() => setPendingAction(null)}
                className="rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={busy || !pin}
                onClick={() => void submitAction()}
                className="rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
