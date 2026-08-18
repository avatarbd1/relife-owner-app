"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { InlineNotice, ProgressBar, Spinner, StatusBadge } from "@/components/FeedbackUI";
import { haptic } from "@/lib/interactions";
import BulkApprovalWidget from "@/components/BulkApprovalWidget";
import { bulkApproveExpenses, bulkRejectExpenses } from "@/app/(dashboard)/finance/operations/actions";
import { useToastContext } from "@/components/ToastProvider";

type Department = "Physio" | "Dental";
type PaidFrom = "Reception" | "Home Treasury" | "Bank";
type FinanceTab = "payment" | "expenses" | "cash" | "salary";

type Snapshot = {
  patients: Array<{
    patientId: string;
    fullName: string;
    department: Department;
    due: number;
  }>;
  staff: Array<{
    staffId: string;
    fullName: string;
    department: "Physio" | "Dental" | "All";
    salary: number;
    paidThisMonth?: number;
    remainingDue?: number;
  }>;
  pendingExpenses: Array<{
    id: string;
    department: Department;
    date: string;
    category: string;
    amount: number;
    note: string;
    requestedBy: string;
  }>;
  approvedExpenses: Array<{
    id: string;
    department: Department;
    date: string;
    category: string;
    amount: number;
    note: string;
    requestedBy: string;
  }>;
  recentPayments: Array<{
    receiptNo: string;
    date: string;
    patientId: string;
    patientName: string;
    department: Department;
    amount: number;
    method: string;
  }>;
  departments: Department[];
  capabilities: {
    paymentCreate: boolean;
    expenseRequest: boolean;
    expenseApprove: boolean;
    expensePay: boolean;
    cashRequest: boolean;
    salaryPay: boolean;
    householdWithdrawal: boolean;
  };
};

type History = {
  expenses: Array<{
    expenseId: string;
    date: string;
    department: Department;
    category: string;
    description: string;
    amount: number;
    status: string;
    expenseType: string;
    paidFrom: string;
    paidBy: string;
    paidAt: string;
    isHouseholdWithdrawal: boolean;
  }>;
  rejectedExpenses: Array<{ expenseId: string }>;
  cashMovements: Array<{
    id: string;
    date: string;
    department: Department;
    fromCustodian: string;
    toCustodian: string;
    amount: number;
    receivedAmount?: number;
    status: string;
    remarks: string;
  }>;
  salaryPayments: Array<{
    id: string;
    date: string;
    department: Department;
    staffId: string;
    staffName: string;
    amount: number;
    type: string;
    paidFrom: string;
    status: string;
    paidAt: string;
  }>;
  capabilities: {
    receptionLimited: boolean;
    expenseHistory: boolean;
    cashHistory: boolean;
    salaryHistory: boolean;
  };
};

function requestId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function bdt(value: number): string {
  return `৳${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(value)}`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-semibold text-slate-700">{children}</label>;
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-[border-color,box-shadow] duration-100 focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

function statusTone(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  const value = status.trim().toLowerCase();
  if (["paid", "accepted", "completed"].includes(value)) return "success";
  if (["approved", "pending", "requested", "approved_pending_payment"].includes(value)) return "warning";
  if (["rejected", "failed", "cancelled", "canceled"].includes(value)) return "error";
  return "info";
}

function ResultMessage({ value }: { value: string | null }) {
  if (!value) return null;
  const good = value.startsWith("✓");
  return (
    <div className={good ? "relife-success-flash" : "relife-error-shake"}>
      <InlineNotice tone={good ? "success" : "error"}>{value}</InlineNotice>
    </div>
  );
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `HTTP_${response.status}`);
  }
  return payload as Record<string, unknown>;
}

function SectionCard({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function FinanceOperationsClient({
  snapshot,
  history,
  initialTab,
}: {
  snapshot: Snapshot;
  history: History;
  initialTab?: FinanceTab;
}) {
  const router = useRouter();
  const toast = useToastContext();
  const defaultDepartment = snapshot.departments[0] || "Physio";
  const availableTabs = useMemo(() => {
    const tabs: FinanceTab[] = [];
    if (snapshot.capabilities.paymentCreate) tabs.push("payment");
    if (snapshot.capabilities.expenseRequest || snapshot.capabilities.expenseApprove || snapshot.capabilities.expensePay || history.capabilities.expenseHistory) tabs.push("expenses");
    if (snapshot.capabilities.cashRequest || history.capabilities.cashHistory) tabs.push("cash");
    if (snapshot.capabilities.salaryPay || history.capabilities.salaryHistory) tabs.push("salary");
    return tabs;
  }, [snapshot.capabilities, history.capabilities]);
  const [tab, setTab] = useState<FinanceTab>(
    initialTab && availableTabs.includes(initialTab) ? initialTab : availableTabs[0] || "payment"
  );
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

  const [paymentPatientId, setPaymentPatientId] = useState(snapshot.patients[0]?.patientId || "");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDiscount, setPaymentDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentSessions, setPaymentSessions] = useState("0");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentRequestId, setPaymentRequestId] = useState(requestId);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);

  const [expenseDepartment, setExpenseDepartment] = useState<Department>(defaultDepartment);
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseType, setExpenseType] = useState("Clinic Expense");
  const [expenseRequestId, setExpenseRequestId] = useState(requestId);
  const [expenseStatus, setExpenseStatus] = useState<string | null>(null);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expensePayFrom, setExpensePayFrom] = useState<PaidFrom>("Reception");
  const [expensePayBusy, setExpensePayBusy] = useState<string | null>(null);
  const [expensePayStatus, setExpensePayStatus] = useState<string | null>(null);

  const [cashDepartment, setCashDepartment] = useState<Department>(defaultDepartment);
  const [cashAmount, setCashAmount] = useState("");
  const [cashTo, setCashTo] = useState("Home Treasury");
  const [cashNote, setCashNote] = useState("");
  const [cashRequestId, setCashRequestId] = useState(requestId);
  const [cashStatus, setCashStatus] = useState<string | null>(null);
  const [cashBusy, setCashBusy] = useState(false);

  const [salaryStaffId, setSalaryStaffId] = useState(snapshot.staff[0]?.staffId || "");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryPaidFrom, setSalaryPaidFrom] = useState<PaidFrom>("Home Treasury");
  const [salaryNote, setSalaryNote] = useState("");
  const [salaryPin, setSalaryPin] = useState("");
  const [salaryRequestId, setSalaryRequestId] = useState(requestId);
  const [salaryStatus, setSalaryStatus] = useState<string | null>(null);
  const [salaryBusy, setSalaryBusy] = useState(false);

  const selectedPatient = useMemo(
    () => snapshot.patients.find((patient) => patient.patientId === paymentPatientId),
    [snapshot.patients, paymentPatientId]
  );
  const selectedStaff = useMemo(
    () => snapshot.staff.find((staff) => staff.staffId === salaryStaffId),
    [snapshot.staff, salaryStaffId]
  );
  const salaryCommitment = snapshot.staff.reduce((sum, staff) => sum + Number(staff.salary || 0), 0);
  const salaryPaid = snapshot.staff.reduce((sum, staff) => sum + Number(staff.paidThisMonth || 0), 0);
  const salaryProgress = salaryCommitment > 0 ? (salaryPaid / salaryCommitment) * 100 : 0;

  async function runAction(setBusy: (value: boolean) => void, setStatus: (value: string | null) => void, action: () => Promise<string>) {
    if (!isOnline) {
      setStatus("✕ Internet connection required for financial writes");
      haptic("error");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const message = await action();
      setStatus(`✓ ${message}`);
      haptic("success");
      router.refresh();
    } catch (error) {
      setStatus(`✕ ${error instanceof Error ? error.message : "Action failed"}`);
      haptic("error");
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!paymentPatientId) return;
    await runAction(setPaymentBusy, setPaymentStatus, async () => {
      const result = await postJson("/api/finance/payment", {
        patientId: paymentPatientId,
        amount: Number(paymentAmount || 0),
        discount: Number(paymentDiscount || 0),
        paymentMethod,
        sessions: Number(paymentSessions || 0),
        remarks: paymentNote,
        requestId: paymentRequestId,
      });
      setPaymentAmount("");
      setPaymentDiscount("0");
      setPaymentSessions("0");
      setPaymentNote("");
      setPaymentRequestId(requestId());
      return `Receipt ${String(result.receiptNo || "created")} · Due ${bdt(Number(result.due || 0))}`;
    });
  }

  async function submitExpense(event: React.FormEvent) {
    event.preventDefault();
    await runAction(setExpenseBusy, setExpenseStatus, async () => {
      const result = await postJson("/api/finance/expense/request", {
        department: expenseDepartment,
        category: expenseCategory,
        amount: Number(expenseAmount),
        note: expenseNote,
        expenseType,
        requestId: expenseRequestId,
      });
      setExpenseCategory("");
      setExpenseAmount("");
      setExpenseNote("");
      setExpenseType("Clinic Expense");
      setExpenseRequestId(requestId());
      return `Expense ${String(result.expenseId || "requested")} · approval pending`;
    });
  }

  async function submitCash(event: React.FormEvent) {
    event.preventDefault();
    await runAction(setCashBusy, setCashStatus, async () => {
      const result = await postJson("/api/finance/cash/request", {
        department: cashDepartment,
        amount: Number(cashAmount),
        toCustodian: cashTo,
        note: cashNote,
        requestId: cashRequestId,
      });
      setCashAmount("");
      setCashNote("");
      setCashRequestId(requestId());
      return `Movement ${String(result.movementId || "requested")} · receiver acceptance pending`;
    });
  }

  async function submitSalary(event: React.FormEvent) {
    event.preventDefault();
    await runAction(setSalaryBusy, setSalaryStatus, async () => {
      const result = await postJson("/api/finance/salary", {
        staffId: salaryStaffId,
        amount: Number(salaryAmount),
        paidFrom: salaryPaidFrom,
        note: salaryNote,
        pin: salaryPin,
        requestId: salaryRequestId,
      });
      setSalaryAmount("");
      setSalaryNote("");
      setSalaryPin("");
      setSalaryRequestId(requestId());
      return `Salary ${String(result.paymentId || "paid")}`;
    });
  }

  async function payExpense(expenseId: string, department: Department) {
    if (!isOnline) {
      setExpensePayStatus("✕ Internet connection required for financial writes");
      haptic("error");
      return;
    }
    setExpensePayBusy(expenseId);
    setExpensePayStatus(null);
    try {
      await postJson("/api/finance/expense/pay", { expenseId, department, paidFrom: expensePayFrom });
      setExpensePayStatus(`✓ ${expenseId} paid from ${expensePayFrom}`);
      haptic("success");
      router.refresh();
    } catch (error) {
      setExpensePayStatus(`✕ ${error instanceof Error ? error.message : "Pay failed"}`);
      haptic("error");
    } finally {
      setExpensePayBusy(null);
    }
  }

  async function handleBulkApproveExpenses(expenseIds: string[]): Promise<{ success: number; failed: number }> {
    if (!isOnline) {
      toast.error("Internet connection required");
      haptic("error");
      throw new Error("Offline");
    }

    const byDepartment = new Map<Department, string[]>();
    for (const expenseId of expenseIds) {
      const expense = snapshot.pendingExpenses.find((e) => e.id === expenseId);
      if (expense) {
        const dept = expense.department as Department;
        if (!byDepartment.has(dept)) byDepartment.set(dept, []);
        byDepartment.get(dept)!.push(expenseId);
      }
    }

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const [department, ids] of byDepartment) {
      const workbook = department === "Physio" ? ("physio" as const) : ("dental" as const);
      try {
        const result = await bulkApproveExpenses(ids, workbook);
        totalSuccess += result.success;
        totalFailed += result.failed;
      } catch (error) {
        totalFailed += ids.length;
      }
    }

    if (totalSuccess > 0) {
      toast.success(`${totalSuccess} expense${totalSuccess === 1 ? "" : "s"} approved`);
      haptic("success");
      router.refresh();
    }

    if (totalFailed > 0) {
      toast.error(`${totalFailed} failed to approve`);
    }

    return { success: totalSuccess, failed: totalFailed };
  }

  async function handleBulkRejectExpenses(expenseIds: string[], reason: string): Promise<{ success: number; failed: number }> {
    if (!isOnline) {
      toast.error("Internet connection required");
      haptic("error");
      throw new Error("Offline");
    }

    const byDepartment = new Map<Department, string[]>();
    for (const expenseId of expenseIds) {
      const expense = snapshot.pendingExpenses.find((e) => e.id === expenseId);
      if (expense) {
        const dept = expense.department as Department;
        if (!byDepartment.has(dept)) byDepartment.set(dept, []);
        byDepartment.get(dept)!.push(expenseId);
      }
    }

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const [department, ids] of byDepartment) {
      const workbook = department === "Physio" ? ("physio" as const) : ("dental" as const);
      try {
        const result = await bulkRejectExpenses(ids, workbook, reason);
        totalSuccess += result.success;
        totalFailed += result.failed;
      } catch (error) {
        totalFailed += ids.length;
      }
    }

    if (totalSuccess > 0) {
      toast.success(`${totalSuccess} expense${totalSuccess === 1 ? "" : "s"} rejected`);
      haptic("success");
      router.refresh();
    }

    if (totalFailed > 0) {
      toast.error(`${totalFailed} failed to reject`);
    }

    return { success: totalSuccess, failed: totalFailed };
  }

  if (availableTabs.length === 0) {
    return <InlineNotice tone="neutral">এই account-এর জন্য finance workflow access নেই।</InlineNotice>;
  }

  return (
    <div className="space-y-4">
      {!isOnline && (
        <InlineNotice tone="warning" title="Offline — financial writes paused">
          History দেখা যেতে পারে যদি page already loaded থাকে, কিন্তু payment, expense, transfer বা salary save করতে internet লাগবে।
        </InlineNotice>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" data-horizontal-scroll>
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Finance workflows">
          {availableTabs.map((item) => {
            const labels: Record<FinanceTab, string> = { payment: "Payment", expenses: "Expenses", cash: "Cash", salary: "Salary" };
            const active = tab === item;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(item);
                  haptic("tap");
                }}
                className={`min-h-11 rounded-lg px-4 text-xs font-semibold ${active ? "bg-blue-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {labels[item]}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "payment" && snapshot.capabilities.paymentCreate && (
        <div className="space-y-4">
          <SectionCard title="Record payment / session" subtitle="Payment and patient due update through the existing idempotent finance API." badge={<StatusBadge tone="info">Online only</StatusBadge>}>
            <form onSubmit={submitPayment} className="space-y-3">
              <div>
                <FieldLabel>Patient</FieldLabel>
                <select className={inputClass} value={paymentPatientId} onChange={(e) => setPaymentPatientId(e.target.value)} required>
                  {snapshot.patients.map((patient) => (
                    <option key={`${patient.department}-${patient.patientId}`} value={patient.patientId}>
                      {patient.patientId} · {patient.fullName} · {patient.department}
                    </option>
                  ))}
                </select>
                {selectedPatient && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <span>Current due</span><strong className="tabular-nums">{bdt(selectedPatient.due)}</strong>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="0" step="1" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></div>
                <div><FieldLabel>Discount</FieldLabel><input className={inputClass} type="number" min="0" step="1" value={paymentDiscount} onChange={(e) => setPaymentDiscount(e.target.value)} /></div>
                <div><FieldLabel>Sessions</FieldLabel><input className={inputClass} type="number" min="0" step="1" value={paymentSessions} onChange={(e) => setPaymentSessions(e.target.value)} /></div>
                <div><FieldLabel>Method</FieldLabel><select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{["Cash", "bKash", "Nagad", "Bank", "Card"].map((item) => <option key={item}>{item}</option>)}</select></div>
              </div>
              <div><FieldLabel>Note / service</FieldLabel><input className={inputClass} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Optional" /></div>
              <button disabled={!isOnline || paymentBusy || !paymentPatientId} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none">
                {paymentBusy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving payment" />}
                {paymentBusy ? "Saving…" : "Record payment"}
              </button>
              <ResultMessage value={paymentStatus} />
            </form>
          </SectionCard>

          <SectionCard title="Recent payments" subtitle="Latest authorized payment records">
            <div className="space-y-2">
              {snapshot.recentPayments.map((payment) => (
                <div key={`${payment.department}-${payment.receiptNo}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{payment.patientName || payment.patientId}</p><p className="mt-0.5 text-[11px] text-slate-500">{payment.receiptNo} · {payment.department} · {payment.date} · {payment.method}</p></div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-700">{bdt(payment.amount)}</span>
                </div>
              ))}
              {snapshot.recentPayments.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Payment history নেই।</p>}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "expenses" && (
        <div className="space-y-4">
          {snapshot.capabilities.expenseRequest && (
            <SectionCard title="New expense request" subtitle="Request → owner decision → payment. Approval alone does not deduct cash." badge={<StatusBadge tone="warning">Approval flow</StatusBadge>}>
              <form onSubmit={submitExpense} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><FieldLabel>Department</FieldLabel><select className={inputClass} value={expenseDepartment} onChange={(e) => setExpenseDepartment(e.target.value as Department)}>{snapshot.departments.map((d) => <option key={d}>{d}</option>)}</select></div>
                  <div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="1" step="1" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} required /></div>
                </div>
                <div><FieldLabel>Category</FieldLabel><input className={inputClass} value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} placeholder="যেমন: Generator Petrol" required /></div>
                {snapshot.capabilities.householdWithdrawal && (
                  <div><FieldLabel>Ledger type</FieldLabel><select className={inputClass} value={expenseType} onChange={(e) => setExpenseType(e.target.value)}><option>Clinic Expense</option><option>Household Withdrawal</option></select></div>
                )}
                {expenseType === "Household Withdrawal" && <InlineNotice tone="info">Household withdrawal owner personal ledger-এ থাকবে; business expense হিসেবে গণনা হবে না।</InlineNotice>}
                <div><FieldLabel>Note</FieldLabel><input className={inputClass} value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} placeholder="Purpose / details" /></div>
                <button disabled={!isOnline || expenseBusy} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none">
                  {expenseBusy && <Spinner size="sm" className="border-white/30 border-t-white" label="Requesting expense" />}
                  {expenseBusy ? "Requesting…" : "Submit expense request"}
                </button>
                <ResultMessage value={expenseStatus} />
              </form>
            </SectionCard>
          )}

          {snapshot.capabilities.expenseApprove && snapshot.pendingExpenses.length > 0 && (
            <SectionCard title="Pending approvals" subtitle="Batch approve or reject multiple expense requests." badge={<StatusBadge tone="warning">{snapshot.pendingExpenses.length} pending</StatusBadge>}>
              <BulkApprovalWidget
                title="Expense requests"
                items={snapshot.pendingExpenses.map((expense) => ({
                  id: expense.id,
                  date: expense.date,
                  category: expense.category,
                  description: expense.category,
                  amount: expense.amount,
                  requestedBy: expense.requestedBy,
                  details: `${expense.category} · ${expense.department}`,
                }))}
                onApprove={handleBulkApproveExpenses}
                onReject={handleBulkRejectExpenses}
                emptyMessage="No pending expense approvals"
                color="amber"
              />
            </SectionCard>
          )}

          {snapshot.capabilities.expensePay && (
            <SectionCard title="Approved · awaiting payment" subtitle="Payment is a separate stage after approval." badge={<StatusBadge tone={snapshot.approvedExpenses.length ? "warning" : "success"}>{snapshot.approvedExpenses.length} awaiting</StatusBadge>}>
              <div className="mb-3"><FieldLabel>Pay from</FieldLabel><select className={inputClass} value={expensePayFrom} onChange={(e) => setExpensePayFrom(e.target.value as PaidFrom)}>{(snapshot.capabilities.householdWithdrawal ? ["Reception", "Home Treasury", "Bank"] : ["Reception"]).map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="space-y-2">
                {snapshot.approvedExpenses.map((expense) => (
                  <article key={`${expense.department}-${expense.id}`} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{expense.category}</p><p className="text-[11px] text-slate-500">{expense.id} · {expense.department} · {expense.date}</p></div><strong className="text-sm tabular-nums text-slate-900">{bdt(expense.amount)}</strong></div>
                    <div className="mt-2"><StatusBadge tone="warning">Approved · unpaid</StatusBadge></div>
                    {expense.note && <p className="mt-2 text-xs text-slate-600">{expense.note}</p>}
                    <button type="button" disabled={!isOnline || expensePayBusy === expense.id} onClick={() => payExpense(expense.id, expense.department)} className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">
                      {expensePayBusy === expense.id && <Spinner size="sm" className="border-white/30 border-t-white" label="Paying expense" />}
                      {expensePayBusy === expense.id ? "Paying…" : `Pay from ${expensePayFrom}`}
                    </button>
                  </article>
                ))}
                {snapshot.approvedExpenses.length === 0 && <InlineNotice tone="success">Approved কিন্তু unpaid expense নেই।</InlineNotice>}
              </div>
              <div className="mt-3"><ResultMessage value={expensePayStatus} /></div>
            </SectionCard>
          )}

          {history.capabilities.expenseHistory && (
            <SectionCard title="Expense status history" subtitle="Pending, approved, paid and rejected remain distinct states." badge={<Link href="/finance/history" className="text-xs font-semibold text-blue-800">Full history →</Link>}>
              <div className="space-y-2">
                {history.expenses.slice(0, 10).map((item) => (
                  <div key={`${item.department}-${item.expenseId}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-800">{item.category || item.expenseType}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.expenseId} · {item.department} · {item.date}</p></div><span className="text-xs font-bold tabular-nums text-slate-900">{bdt(item.amount)}</span></div>
                    <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>{item.isHouseholdWithdrawal && <StatusBadge tone="info">Household</StatusBadge>}</div>
                    {item.description && <p className="mt-2 text-xs text-slate-600">{item.description}</p>}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {tab === "cash" && (
        <div className="space-y-4">
          <InlineNotice tone="info" title="Internal cash movement — not an expense">
            Reception → Home Treasury/Bank moves custody only. Accepted received amount drives the cash position.
          </InlineNotice>
          {snapshot.capabilities.cashRequest && (
            <SectionCard title="Request cash handover" subtitle="Receiver must accept the actual amount before the transfer becomes effective." badge={<StatusBadge tone="info">Transfer</StatusBadge>}>
              <form onSubmit={submitCash} className="space-y-3">
                <div className="grid grid-cols-2 gap-3"><div><FieldLabel>Department</FieldLabel><select className={inputClass} value={cashDepartment} onChange={(e) => setCashDepartment(e.target.value as Department)}>{snapshot.departments.map((d) => <option key={d}>{d}</option>)}</select></div><div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="1" step="1" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} required /></div></div>
                <div><FieldLabel>To custodian</FieldLabel><select className={inputClass} value={cashTo} onChange={(e) => setCashTo(e.target.value)}><option>Home Treasury</option><option>Bank</option></select></div>
                <div><FieldLabel>Note</FieldLabel><input className={inputClass} value={cashNote} onChange={(e) => setCashNote(e.target.value)} placeholder="Optional" /></div>
                <button disabled={!isOnline || cashBusy} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none">
                  {cashBusy && <Spinner size="sm" className="border-white/30 border-t-white" label="Requesting handover" />}
                  {cashBusy ? "Requesting…" : "Request handover"}
                </button>
                <ResultMessage value={cashStatus} />
              </form>
            </SectionCard>
          )}
          {history.capabilities.cashHistory && (
            <SectionCard title="Cash movement history" subtitle="Discrepancies are highlighted when received amount differs from requested amount." badge={<Link href="/finance/history" className="text-xs font-semibold text-blue-800">Full history →</Link>}>
              <div className="space-y-2">
                {history.cashMovements.slice(0, 12).map((item) => {
                  const actual = item.receivedAmount;
                  const discrepancy = actual !== undefined && Math.abs(actual - item.amount) > 0.009;
                  return (
                    <div key={`${item.department}-${item.id}`} className={`rounded-lg border p-3 ${discrepancy ? "border-amber-300 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-800">{item.fromCustodian} → {item.toCustodian}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.id} · {item.department} · {item.date}</p></div><strong className="text-xs tabular-nums text-slate-900">{bdt(item.amount)}</strong></div>
                      <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>{discrepancy && <StatusBadge tone="warning">Discrepancy</StatusBadge>}</div>
                      {actual !== undefined && <p className={`mt-2 text-xs ${discrepancy ? "font-semibold text-amber-800" : "text-slate-500"}`}>Actual received: {bdt(actual)}</p>}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {tab === "salary" && (
        <div className="space-y-4">
          {snapshot.capabilities.salaryPay && (
            <>
              <SectionCard title="Payroll summary" subtitle="Fixed commitment from staff master; paid/advance from this month’s salary ledger." badge={<StatusBadge tone={salaryProgress >= 100 ? "success" : "warning"}>{Math.round(salaryProgress)}% paid</StatusBadge>}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2"><p className="text-[10px] text-slate-500">Commitment</p><p className="mt-1 text-xs font-bold tabular-nums text-slate-900">{bdt(salaryCommitment)}</p></div>
                  <div className="rounded-lg bg-emerald-50 p-2"><p className="text-[10px] text-emerald-700">Paid</p><p className="mt-1 text-xs font-bold tabular-nums text-emerald-800">{bdt(salaryPaid)}</p></div>
                  <div className="rounded-lg bg-red-50 p-2"><p className="text-[10px] text-red-700">Remaining</p><p className="mt-1 text-xs font-bold tabular-nums text-red-800">{bdt(Math.max(0, salaryCommitment - salaryPaid))}</p></div>
                </div>
                <ProgressBar value={salaryProgress} label="This month paid" className="mt-4" />
              </SectionCard>

              <SectionCard title="Pay salary / advance" subtitle="Owner PIN is required for every payroll write." badge={<StatusBadge tone="info">PIN protected</StatusBadge>}>
                <form onSubmit={submitSalary} className="space-y-3">
                  <div><FieldLabel>Staff</FieldLabel><select className={inputClass} value={salaryStaffId} onChange={(e) => setSalaryStaffId(e.target.value)}>{snapshot.staff.map((staff) => <option key={staff.staffId} value={staff.staffId}>{staff.staffId} · {staff.fullName} · {staff.department}</option>)}</select></div>
                  {selectedStaff && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Fixed salary</span><strong className="text-sm tabular-nums text-slate-900">{bdt(selectedStaff.salary || 0)}</strong></div>
                      <div className="mt-1 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Paid / advance</span><strong className="text-sm tabular-nums text-emerald-700">{bdt(selectedStaff.paidThisMonth || 0)}</strong></div>
                      <div className="mt-1 flex items-center justify-between gap-3"><span className="text-xs font-medium text-slate-600">Remaining</span><strong className="text-sm tabular-nums text-red-700">{bdt(selectedStaff.remainingDue || 0)}</strong></div>
                      <ProgressBar value={(selectedStaff.salary || 0) > 0 ? ((selectedStaff.paidThisMonth || 0) / (selectedStaff.salary || 1)) * 100 : 0} label="Paid" className="mt-3" />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3"><div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="1" step="1" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} required /></div><div><FieldLabel>Paid from</FieldLabel><select className={inputClass} value={salaryPaidFrom} onChange={(e) => setSalaryPaidFrom(e.target.value as PaidFrom)}><option>Home Treasury</option><option>Reception</option><option>Bank</option></select></div></div>
                  <div><FieldLabel>Note</FieldLabel><input className={inputClass} value={salaryNote} onChange={(e) => setSalaryNote(e.target.value)} placeholder="Advance / salary note" /></div>
                  <div><FieldLabel>Owner PIN</FieldLabel><input className={inputClass} type="password" inputMode="numeric" maxLength={6} value={salaryPin} onChange={(e) => setSalaryPin(e.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>
                  <button disabled={!isOnline || salaryBusy || !salaryStaffId} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-900 disabled:shadow-none">
                    {salaryBusy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving salary" />}
                    {salaryBusy ? "Saving…" : "Pay salary / advance"}
                  </button>
                  <ResultMessage value={salaryStatus} />
                </form>
              </SectionCard>
            </>
          )}
          {history.capabilities.salaryHistory && (
            <SectionCard title="Salary history" subtitle="Individual payroll evidence" badge={<Link href="/finance/history" className="text-xs font-semibold text-blue-800">Full history →</Link>}>
              <div className="space-y-2">
                {history.salaryPayments.slice(0, 12).map((item) => (
                  <div key={`${item.department}-${item.id}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{item.staffName || item.staffId}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.date} · {item.type} · {item.paidFrom}</p><div className="mt-2"><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge></div></div>
                    <strong className="text-xs tabular-nums text-slate-900">{bdt(item.amount)}</strong>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
