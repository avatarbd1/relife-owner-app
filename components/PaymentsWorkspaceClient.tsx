"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { InlineNotice, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import { useToastContext } from "@/components/ToastProvider";

type Department = "Physio" | "Dental";
type Patient = { patientId: string; fullName: string; department: Department; due: number };
type RecentPayment = {
  receiptNo: string;
  date: string;
  patientId: string;
  patientName: string;
  department: Department;
  amount: number;
  method: string;
};

type SavedReceipt = {
  receiptNo: string;
  patientId: string;
  patientName: string;
  department: Department;
  gross: number;
  discount: number;
  net: number;
  method: string;
  transactionId: string;
  newDue: number;
  savedAt: string;
};

function requestId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function localNow(): string {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date());
}

const LAST_PATIENT_STORAGE_KEY = "relife_payment_last_patient_id";
const RECENT_PAYMENT_LIMIT = 5;

export default function PaymentsWorkspaceClient({
  patients,
  recentPayments,
  initialPatientId,
}: {
  patients: Patient[];
  recentPayments: RecentPayment[];
  initialPatientId?: string;
}) {
  const router = useRouter();
  const toast = useToastContext();

  const getInitialPatient = () => {
    if (initialPatientId) {
      return patients.find((p) => p.patientId === initialPatientId) || patients[0];
    }

    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(LAST_PATIENT_STORAGE_KEY);
      if (saved) {
        const patient = patients.find((p) => p.patientId === saved);
        if (patient) return patient;
      }
    }

    return patients[0];
  };

  const initialPatient = getInitialPatient();
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState(initialPatient?.patientId || "");
  const [gross, setGross] = useState(String(initialPatient?.due || 0));
  const [discountMode, setDiscountMode] = useState<"none" | "5" | "10" | "custom">("none");
  const [customDiscount, setCustomDiscount] = useState("0");
  const [method, setMethod] = useState("Cash");
  const [transactionId, setTransactionId] = useState("");
  const [sessions, setSessions] = useState("0");
  const [note, setNote] = useState("");
  const [webRequestId, setWebRequestId] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SavedReceipt | null>(null);
  const [online, setOnline] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (patientId) {
      try {
        localStorage.setItem(LAST_PATIENT_STORAGE_KEY, patientId);
      } catch {
        // localStorage not available, silently ignore
      }
    }
  }, [patientId]);

  const selected = useMemo(
    () => patients.find((patient) => patient.patientId === patientId),
    [patients, patientId]
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return patients.slice(0, 12);
    return patients
      .filter((patient) => `${patient.patientId} ${patient.fullName} ${patient.department}`.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [patients, query]);
  const grossNumber = Math.max(0, Number(gross || 0));
  const discount = useMemo(() => {
    if (discountMode === "5") return Math.round(grossNumber * 0.05);
    if (discountMode === "10") return Math.round(grossNumber * 0.1);
    if (discountMode === "custom") return Math.max(0, Number(customDiscount || 0));
    return 0;
  }, [discountMode, customDiscount, grossNumber]);
  const net = Math.max(0, grossNumber - discount);
  const previewDue = Math.max(0, Number(selected?.due || 0) - grossNumber);
  const visibleRecentPayments = recentPayments.slice(0, RECENT_PAYMENT_LIMIT);
  const similarRecentPayment = useMemo(
    () =>
      selected
        ? recentPayments.find(
            (payment) =>
              payment.patientId === selected.patientId &&
              payment.department === selected.department &&
              payment.amount === net &&
              payment.method === method
          )
        : undefined,
    [method, net, recentPayments, selected]
  );

  function choosePatient(patient: Patient) {
    setPatientId(patient.patientId);
    setGross(String(patient.due || 0));
    setDiscountMode("none");
    setCustomDiscount("0");
    setTransactionId("");
    setSessions("0");
    setNote("");
    setReceipt(null);
    setConfirmOpen(false);
    setWebRequestId(requestId());
    setQuery("");
    haptic("tap");
  }

  function startNewPayment() {
    setReceipt(null);
    setConfirmOpen(false);
    setWebRequestId(requestId());
    setTransactionId("");
    setSessions("0");
    setNote("");
    haptic("tap");
  }

  function requestPaymentConfirmation() {
    if (!selected || busy || receipt) return;
    if (!online) {
      toast.error("Internet connection required for payment writes");
      haptic("error");
      return;
    }
    if (grossNumber <= 0 && Number(sessions || 0) <= 0) {
      toast.error("Enter an amount or session count");
      haptic("error");
      return;
    }
    setConfirmOpen(true);
    haptic("tap");
  }

  async function savePayment() {
    if (!selected || busy || receipt) return;
    setBusy(true);
    try {
      const remarks = [
        note.trim(),
        method === "bKash" && transactionId.trim() ? `bKash TxID: ${transactionId.trim()}` : "",
      ].filter(Boolean).join(" | ");
      const response = await fetch("/api/finance/payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: selected.patientId,
          amount: net,
          discount,
          paymentMethod: method,
          sessions: Number(sessions || 0),
          remarks,
          requestId: webRequestId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "PAYMENT_SAVE_FAILED");
      const saved: SavedReceipt = {
        receiptNo: String(payload.receiptNo || ""),
        patientId: selected.patientId,
        patientName: selected.fullName,
        department: selected.department,
        gross: grossNumber,
        discount,
        net,
        method,
        transactionId: transactionId.trim(),
        newDue: Number(payload.due || 0),
        savedAt: localNow(),
      };
      setReceipt(saved);
      setConfirmOpen(false);
      toast.success(payload.duplicate ? `Already saved · ${saved.receiptNo}` : `Payment saved · ${saved.receiptNo}`, 5000);
      haptic("success");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payment failed");
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  const receiptText = receipt
    ? [
        `Relife Clinic · Receipt ${receipt.receiptNo}`,
        `${receipt.patientName} (${receipt.patientId})`,
        `${receipt.department}`,
        `Gross: ${bdt(receipt.gross)}`,
        `Discount: ${bdt(receipt.discount)}`,
        `Paid: ${bdt(receipt.net)}`,
        `Method: ${receipt.method}${receipt.transactionId ? ` · TxID ${receipt.transactionId}` : ""}`,
        `Remaining due: ${bdt(receipt.newDue)}`,
        receipt.savedAt,
      ].join("\n")
    : "";

  async function copyReceipt() {
    if (!receiptText) return;
    await navigator.clipboard.writeText(receiptText);
    toast.success("Receipt copied");
    haptic("success");
  }

  async function shareReceipt() {
    if (!receiptText) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Relife receipt ${receipt?.receiptNo || ""}`, text: receiptText });
        haptic("success");
        return;
      } catch {
        return;
      }
    }
    await copyReceipt();
  }

  return (
    <div className="space-y-4" data-unsaved-changes={selected && !receipt ? "true" : "false"}>
      {!online && <InlineNotice tone="warning" title="Offline — payment writes disabled">Financial writes are never queued silently.</InlineNotice>}
      {receipt && (
        <InlineNotice tone="success" title="Payment recorded">
          {receipt.patientName} · {bdt(receipt.net)} · {receipt.receiptNo}. একই payment আবার save করতে হলে “New payment” চাপুন।
        </InlineNotice>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-slate-950">Patient payment</h2><p className="mt-0.5 text-xs text-slate-500">Search, select, review due and confirm payment.</p></div>
          <StatusBadge tone="info">Duplicate protected</StatusBadge>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Search patient</label>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or patient ID…" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" />
          {query && (
            <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" data-swipe-nav-ignore>
              {filtered.map((patient) => (
                <button key={`${patient.department}-${patient.patientId}`} type="button" onClick={() => choosePatient(patient)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 text-left last:border-b-0 hover:bg-slate-50">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{patient.fullName}</span><span className="block text-[11px] text-slate-500">{patient.patientId} · {patient.department}</span></span>
                  <span className="text-xs font-bold tabular-nums text-red-700">{bdt(patient.due)}</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="p-3 text-xs text-slate-400">No matching patient.</p>}
            </div>
          )}
        </div>

        {selected ? (
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm font-semibold text-slate-900">{selected.fullName}</p><p className="mt-0.5 text-[11px] text-slate-500">{selected.patientId}</p></div>
              <div className="flex flex-wrap gap-2"><StatusBadge tone={selected.department === "Dental" ? "success" : "info"}>{selected.department}</StatusBadge><StatusBadge tone={selected.due > 0 ? "error" : "success"}>{selected.due > 0 ? `Due ${bdt(selected.due)}` : "Paid up"}</StatusBadge></div>
            </div>
          </div>
        ) : <InlineNotice tone="neutral">Select a patient to record payment.</InlineNotice>}
      </section>

      {selected && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Amount & discount</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Gross amount</label>
              <div className="relative"><span className="absolute left-3 top-3 text-sm font-semibold text-slate-400">৳</span><input type="number" min="0" step="1" value={gross} onChange={(event) => setGross(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-200 pl-8 pr-3 text-sm font-semibold outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {[500, 1000, 1500, 2000, 2500].map((value) => <button key={value} type="button" onClick={() => { setGross(String(value)); setMethod("Cash"); haptic("tap"); }} className="min-h-10 rounded-lg bg-amber-50 px-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100">{value}</button>)}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Discount</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(["none", "5", "10", "custom"] as const).map((item) => <button key={item} type="button" onClick={() => { setDiscountMode(item); haptic("tap"); }} className={`min-h-11 rounded-lg border text-xs font-semibold ${discountMode === item ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{item === "none" ? "None" : item === "custom" ? "Custom" : `${item}%`}</button>)}
              </div>
              {discountMode === "custom" && <input type="number" min="0" step="1" value={customDiscount} onChange={(event) => setCustomDiscount(event.target.value)} placeholder="Discount ৳" className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" />}
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-blue-50 p-3">
            <div className="space-y-1.5 text-xs"><div className="flex justify-between text-slate-600"><span>Gross</span><span>{bdt(grossNumber)}</span></div><div className="flex justify-between text-slate-600"><span>Discount</span><span>- {bdt(discount)}</span></div><div className="border-t border-blue-100 pt-2 flex justify-between text-blue-950"><strong>Net cash</strong><strong className="text-lg tabular-nums">{bdt(net)}</strong></div></div>
          </div>
        </section>
      )}

      {selected && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Payment method</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            {["Cash", "bKash", "Nagad", "Bank", "Card"].map((item) => <button key={item} type="button" onClick={() => { setMethod(item); haptic("tap"); }} className={`min-h-11 rounded-lg border text-xs font-semibold ${method === item ? "border-blue-800 bg-blue-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{item}</button>)}
          </div>
          {method === "bKash" && (
            <div className="relife-fade-in mt-3"><label className="mb-1.5 block text-xs font-semibold text-slate-700">bKash transaction ID</label><input value={transactionId} onChange={(event) => setTransactionId(event.target.value)} placeholder="Transaction ID" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3"><div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Sessions</label><input type="number" min="0" step="1" value={sessions} onChange={(event) => setSessions(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div><div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Note / service</label><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100" /></div></div>
        </section>
      )}

      {selected && (
        <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">Receipt preview</h2><p className="mt-0.5 text-xs text-slate-500">Final receipt number is assigned by the server on save.</p></div><StatusBadge tone={receipt ? "success" : "info"}>{receipt ? "Saved" : "Preview"}</StatusBadge></div>
          <div className="relife-fade-in mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50">
            {[ ["Receipt #", receipt?.receiptNo || "Assigned on save"], ["Patient", `${selected.fullName} · ${selected.patientId}`], ["Department", selected.department], ["Gross", bdt(grossNumber)], ["Discount", bdt(discount)], ["Net cash", bdt(net)], ["Method", method], ["Projected due", bdt(previewDue)] ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 px-3 py-2.5"><span className="text-xs text-slate-500">{label}</span><span className={`text-xs font-semibold text-right ${label === "Net cash" ? "text-blue-900" : "text-slate-900"}`}>{value}</span></div>)}
          </div>
          <button type="button" disabled={busy || !online || net < 0 || Boolean(receipt)} onClick={requestPaymentConfirmation} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none">{busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving payment" />}{busy ? "Saving…" : receipt ? "Payment recorded" : "Review & confirm"}</button>
          {receipt && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <button type="button" onClick={startNewPayment} className="min-h-11 rounded-lg bg-blue-800 px-2 text-xs font-semibold text-white hover:bg-blue-900">New payment</button>
              <Link href={`/appointments/new?patientId=${encodeURIComponent(receipt.patientId)}&department=${receipt.department}`} className="flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-2 text-center text-xs font-semibold text-white hover:bg-emerald-800">Next appointment</Link>
              <button type="button" onClick={copyReceipt} className="min-h-11 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Copy</button>
              <button type="button" onClick={() => window.print()} className="min-h-11 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Print / PDF</button>
              <button type="button" onClick={shareReceipt} className="min-h-11 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">Share</button>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-950">Recent payments</h2><p className="mt-0.5 text-xs text-slate-500">Latest {RECENT_PAYMENT_LIMIT} authorized records</p></div><Link href="/finance/history" className="text-xs font-semibold text-blue-800">View all →</Link></div>
        <div className="mt-3 space-y-2">
          {visibleRecentPayments.map((payment) => <article key={`${payment.department}-${payment.receiptNo}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{payment.patientName || payment.patientId}</p><p className="mt-0.5 text-[11px] text-slate-500">{payment.patientId} · {payment.date} · {payment.method}</p></div><strong className="text-sm tabular-nums text-emerald-700">{bdt(payment.amount)}</strong></div></article>)}
          {recentPayments.length === 0 && <InlineNotice tone="neutral">Payment history নেই।</InlineNotice>}
        </div>
      </section>

      {confirmOpen && selected && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-slate-950/45 p-3 sm:place-items-center" role="presentation" onClick={() => !busy && setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="payment-confirm-title" data-swipe-nav-ignore onClick={(event) => event.stopPropagation()}>
            <h2 id="payment-confirm-title" className="text-lg font-bold text-slate-950">Confirm payment?</h2>
            <p className="mt-1 text-sm text-slate-600">Save করার আগে patient ও amount আরেকবার মিলিয়ে নিন।</p>
            {similarRecentPayment && (
              <InlineNotice tone="warning" title="Similar payment found">
                এই patient-এর {bdt(net)} {method} payment recent history-তে আছে ({similarRecentPayment.receiptNo})। সত্যিই নতুন payment হলে তবেই Confirm করুন।
              </InlineNotice>
            )}
            <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50 text-sm">
              <div className="flex justify-between gap-3 px-3 py-2.5"><span className="text-slate-500">Patient</span><strong className="text-right text-slate-900">{selected.fullName} · {selected.patientId}</strong></div>
              <div className="flex justify-between gap-3 px-3 py-2.5"><span className="text-slate-500">Net payment</span><strong className="text-right text-blue-900">{bdt(net)}</strong></div>
              <div className="flex justify-between gap-3 px-3 py-2.5"><span className="text-slate-500">Method</span><strong className="text-right text-slate-900">{method}</strong></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmOpen(false)} className="min-h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={busy} onClick={savePayment} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-800 text-sm font-semibold text-white disabled:opacity-50">{busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving payment" />}{busy ? "Saving…" : "Confirm & save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
