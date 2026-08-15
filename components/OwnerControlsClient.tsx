"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";

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

export default function OwnerControlsClient({ snapshot }: { snapshot: Snapshot }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pin, setPin] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const pendingTotal = snapshot.pendingExpenses.length + snapshot.pendingCashMovements.length;
  const actionAmount = useMemo(() => pendingAction?.item.amount || 0, [pendingAction]);
  const receivedNumber = Number(receivedAmount || actionAmount);
  const discrepancy =
    pendingAction?.kind === "cash" &&
    pendingAction.decision === "accept" &&
    Number.isFinite(receivedNumber)
      ? receivedNumber - actionAmount
      : 0;
  const rejectionNeedsReason =
    pendingAction?.kind === "expense" && pendingAction.decision === "reject";

  function openAction(action: PendingAction) {
    setMessage(null);
    setPin("");
    setDecisionReason("");
    setReceivedAmount(action.kind === "cash" && action.decision === "accept" ? String(action.item.amount) : "");
    setPendingAction(action);
    haptic("tap");
  }

  async function submitAction() {
    if (!pendingAction || !pin || busy) return;
    if (rejectionNeedsReason && decisionReason.trim().length < 3) {
      setMessage({ text: "Rejection reason is required.", good: false });
      haptic("error");
      return;
    }
    if (!isOnline) {
      setMessage({ text: "Internet connection required for owner financial actions.", good: false });
      haptic("error");
      return;
    }
    setBusy(true);
    setMessage(null);

    const isExpense = pendingAction.kind === "expense";
    const payload: Record<string, unknown> = {
      workbook: pendingAction.item.workbook,
      id: pendingAction.item.id,
      decision: pendingAction.decision,
      pin,
    };
    if (isExpense && pendingAction.decision === "reject") {
      payload.reason = decisionReason.trim();
    }
    if (!isExpense && pendingAction.decision === "accept") {
      payload.receivedAmount = Number(receivedAmount || pendingAction.item.amount);
    }

    try {
      const response = await fetch(isExpense ? "/api/control/expense" : "/api/control/cash-movement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
      setMessage({ text: "Saved successfully.", good: true });
      setPendingAction(null);
      setPin("");
      setDecisionReason("");
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Action failed", good: false });
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  if (pendingTotal === 0) {
    return <InlineNotice tone="success">No pending approvals. Expense and cash requests are up to date.</InlineNotice>;
  }

  return (
    <div className="space-y-4">
      {!isOnline && <InlineNotice tone="warning">Offline — owner approval and cash acceptance require internet.</InlineNotice>}

      {snapshot.pendingExpenses.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div><h2 className="text-base font-semibold text-slate-900">Expense approvals</h2><p className="mt-0.5 text-xs text-slate-500">Decision only; approval does not deduct cash</p></div>
            <StatusBadge tone="warning">{snapshot.pendingExpenses.length} pending</StatusBadge>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {snapshot.pendingExpenses.map((item) => (
              <article key={`${item.workbook}-${item.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.category || item.id}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.date} · {item.requestedBy || "Unknown"}</p></div>
                  <StatusBadge tone="info">{item.department}</StatusBadge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3"><span className="truncate text-xs text-slate-500">Requested source: {item.paidFrom || "Not set"}</span><strong className="text-sm tabular-nums text-slate-950">{bdt(item.amount)}</strong></div>
                {item.note && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-600">{item.note}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button disabled={!snapshot.writeEnabled || !isOnline} onClick={() => openAction({ kind: "expense", decision: "reject", item })} className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50">Reject</button>
                  <button disabled={!snapshot.writeEnabled || !isOnline} onClick={() => openAction({ kind: "expense", decision: "approve", item })} className="min-h-10 rounded-lg bg-blue-800 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-900">Approve</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {snapshot.pendingCashMovements.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div><h2 className="text-base font-semibold text-slate-900">Cash handover acceptance</h2><p className="mt-0.5 text-xs text-slate-500">Confirm actual cash received; internal transfer, not expense</p></div>
            <StatusBadge tone="warning">{snapshot.pendingCashMovements.length} pending</StatusBadge>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {snapshot.pendingCashMovements.map((item) => (
              <article key={`${item.workbook}-${item.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.from} → {item.to}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.date} · {item.movedBy || "Unknown"}</p></div><StatusBadge tone="info">{item.department}</StatusBadge></div>
                <div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-500">Requested</span><strong className="text-sm tabular-nums text-slate-950">{bdt(item.amount)}</strong></div>
                <div className="mt-3 grid grid-cols-2 gap-2"><button disabled={!snapshot.writeEnabled || !isOnline} onClick={() => openAction({ kind: "cash", decision: "reject", item })} className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50">Reject</button><button disabled={!snapshot.writeEnabled || !isOnline} onClick={() => openAction({ kind: "cash", decision: "accept", item })} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700">Accept received</button></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {message && <div className={message.good ? "relife-success-flash" : "relife-error-shake"}><InlineNotice tone={message.good ? "success" : "error"}>{message.text}</InlineNotice></div>}

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-4 backdrop-blur-[1px] sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Confirm owner action">
          <div className="relife-page-enter w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-900">Confirm {pendingAction.decision}</h3><p className="mt-1 text-xs text-slate-500">{pendingAction.item.id} · {bdt(actionAmount)}</p></div><StatusBadge tone={pendingAction.decision === "reject" ? "error" : pendingAction.kind === "cash" ? "success" : "info"}>{pendingAction.kind}</StatusBadge></div>

            {pendingAction.kind === "cash" && pendingAction.decision === "accept" && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-700">Received amount<input type="number" min="0" inputMode="decimal" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" /></label>
                {Math.abs(discrepancy) > 0.009 && <div className="mt-2"><InlineNotice tone="warning">Discrepancy: {discrepancy > 0 ? "+" : ""}{bdt(discrepancy)} versus requested amount. The accepted amount becomes the cash effect.</InlineNotice></div>}
              </div>
            )}

            {rejectionNeedsReason && (
              <label className="mt-4 block text-xs font-semibold text-slate-700">Rejection reason<textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={2} minLength={3} className="mt-1.5 w-full rounded-lg border border-red-200 px-3 py-2 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100" placeholder="Why is this expense being rejected?" /></label>
            )}

            <label className="mt-4 block text-xs font-semibold text-slate-700">Owner PIN<input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(event) => { if (event.key === "Enter" && pin && !busy && (!rejectionNeedsReason || decisionReason.trim().length >= 3)) void submitAction(); }} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" placeholder="Enter PIN" /></label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => setPendingAction(null)} className="min-h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button disabled={busy || !pin || !isOnline || (rejectionNeedsReason && decisionReason.trim().length < 3)} onClick={() => void submitAction()} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-sm ${pendingAction.decision === "reject" ? "bg-red-600 hover:bg-red-700" : pendingAction.kind === "cash" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-800 hover:bg-blue-900"}`}>
                {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving owner action" />}
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
