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
  const [logoutBusy, setLogoutBusy] = useState(false);

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
      setMessage("Done. Live Sheet updated.");
      setPendingAction(null);
      setPin("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setLogoutBusy(true);
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Owner control center</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Stage E · protected financial actions
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Private Sheets</span>
            <span className={snapshot.privateSheets ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
              {snapshot.privateSheets ? "Connected" : "Unavailable"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Write gate</span>
            <span className={snapshot.writeEnabled ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
              {snapshot.writeEnabled ? "PIN protected" : "Locked"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Pending owner actions</span>
            <span className="font-semibold text-slate-900">{pendingTotal}</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-slate-400">
          Every write re-checks the live row, requires the Owner PIN, and records an audit entry. Approved expenses are not marked paid automatically.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Expense approvals</h2>
            <p className="mt-0.5 text-xs text-slate-400">07_Expenses · Pending Approval</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
            {snapshot.pendingExpenses.length}
          </span>
        </div>

        <div className="space-y-3">
          {snapshot.pendingExpenses.map((item) => (
            <article key={`${item.workbook}-${item.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{item.category || item.id}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{item.id} · {item.date} · {item.requestedBy || "Unknown"}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${departmentPill(item.department)}`}>
                  {item.department}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">From {item.paidFrom || "-"}</span>
                <span className="text-base font-semibold text-slate-900">{bdt(item.amount)}</span>
              </div>
              {item.note && <p className="mt-2 text-xs text-slate-500">{item.note}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  disabled={!snapshot.writeEnabled}
                  onClick={() => openAction({ kind: "expense", decision: "reject", item })}
                  className="rounded-xl border border-red-200 bg-white py-2 text-xs font-semibold text-red-600 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  disabled={!snapshot.writeEnabled}
                  onClick={() => openAction({ kind: "expense", decision: "approve", item })}
                  className="rounded-xl bg-slate-900 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Approve
                </button>
              </div>
            </article>
          ))}
          {snapshot.pendingExpenses.length === 0 && (
            <p className="py-5 text-center text-sm text-slate-400">No pending expense approval.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Cash movement confirmation</h2>
            <p className="mt-0.5 text-xs text-slate-400">21_Cash_Movement · pending requests only</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
            {snapshot.pendingCashMovements.length}
          </span>
        </div>

        <div className="space-y-3">
          {snapshot.pendingCashMovements.map((item) => (
            <article key={`${item.workbook}-${item.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.from} → {item.to}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{item.id} · {item.date} · {item.movedBy || "Unknown"}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${departmentPill(item.department)}`}>
                  {item.department}
                </span>
              </div>
              <p className="mt-2 text-base font-semibold text-slate-900">{bdt(item.amount)}</p>
              {item.note && <p className="mt-1 text-xs text-slate-500">{item.note}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  disabled={!snapshot.writeEnabled}
                  onClick={() => openAction({ kind: "cash", decision: "reject", item })}
                  className="rounded-xl border border-red-200 bg-white py-2 text-xs font-semibold text-red-600 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  disabled={!snapshot.writeEnabled}
                  onClick={() => openAction({ kind: "cash", decision: "accept", item })}
                  className="rounded-xl bg-slate-900 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Accept
                </button>
              </div>
            </article>
          ))}
          {snapshot.pendingCashMovements.length === 0 && (
            <p className="py-5 text-center text-sm text-slate-400">No pending cash movement.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-800">Payment control</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          06_Payments currently has no approval/status columns. Direct payment mutation is intentionally disabled until that schema is defined, so existing collection data cannot be silently changed.
        </p>
      </section>

      {message && (
        <p className={`rounded-xl px-3 py-2 text-xs ${message.startsWith("Done") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </p>
      )}

      <button
        onClick={logout}
        disabled={logoutBusy}
        className="w-full rounded-xl bg-slate-900 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {logoutBusy ? "Logging out..." : "Log out"}
      </button>

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Confirm owner action</h3>
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
