"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastProvider";
import { formatBDT } from "@/lib/format";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";
type Destination = "Home Treasury" | "Bank";

export default function CashMovementForm({ departments }: { departments: Department[] }) {
  const toast = useToastContext();
  const requestIdRef = useRef("");
  const [department, setDepartment] = useState<Department>(departments[0] || "Physio");
  const [destination, setDestination] = useState<Destination>("Home Treasury");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    requestIdRef.current = "";
  }, [department, destination, amount, note]);

  function requestId(): string {
    if (!requestIdRef.current) {
      requestIdRef.current = `CASHREQ_${window.crypto.randomUUID().replace(/-/g, "")}`;
    }
    return requestIdRef.current;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error("Enter a valid positive amount");
      return;
    }

    setBusy(true);
    haptic("tap");
    try {
      const response = await fetch("/api/finance/cash/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          department,
          amount: numericAmount,
          toCustodian: destination,
          note,
          requestId: requestId(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        if (payload.error === "INSUFFICIENT_RECEPTION_CASH") {
          throw new Error(`Insufficient reception cash. Available: ${formatBDT(Number(payload.available || 0))}`);
        }
        throw new Error(payload.error || "Cash movement request failed");
      }
      toast.success(payload.duplicate ? "Cash movement already recorded" : "Cash movement request submitted");
      haptic("success");
      requestIdRef.current = "";
      setAmount("");
      setNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cash movement request failed");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Cash movement request form">
      <div className="space-y-4">
        {departments.length > 1 && (
          <div>
            <label htmlFor="cash-department" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department</label>
            <select id="cash-department" value={department} onChange={(event) => setDepartment(event.target.value as Department)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900">
              {departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        )}

        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Destination</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["Home Treasury", "Bank"] as Destination[]).map((item) => (
              <label key={item} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 ${destination === item ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}>
                <input type="radio" name="destination" value={item} checked={destination === item} onChange={() => setDestination(item)} disabled={busy} />
                <span className="text-sm font-semibold text-slate-800">Reception → {item}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="cash-amount" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount (BDT)</label>
          <input id="cash-amount" type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          {Number(amount) > 0 && <p className="mt-1 text-xs font-semibold text-blue-800">{formatBDT(Number(amount))}</p>}
        </div>

        <div>
          <label htmlFor="cash-note" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason / note</label>
          <textarea id="cash-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900" placeholder="Why is this movement needed?" />
        </div>

        <button type="submit" disabled={busy || departments.length === 0} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
          {busy && <Spinner size="sm" className="border-white/30 border-t-white" />}
          {busy ? "Submitting…" : "Request cash movement"}
        </button>
        <p className="text-xs text-slate-500">This creates the existing pending custody movement. Cash position changes only after the canonical acceptance step.</p>
      </div>
    </form>
  );
}
