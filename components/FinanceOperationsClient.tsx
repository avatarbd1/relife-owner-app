"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Department = "Physio" | "Dental";
type PaidFrom = "Reception" | "Home Treasury" | "Bank";

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
    expensePay: boolean;
    cashRequest: boolean;
    salaryPay: boolean;
    householdWithdrawal: boolean;
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
  return <label className="mb-1 block text-xs font-medium text-slate-600">{children}</label>;
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500";

function Status({ value }: { value: string | null }) {
  if (!value) return null;
  const good = value.startsWith("✓");
  return (
    <p className={`mt-3 text-xs ${good ? "text-emerald-700" : "text-red-600"}`} role="status">
      {value}
    </p>
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

export default function FinanceOperationsClient({ snapshot }: { snapshot: Snapshot }) {
  const router = useRouter();
  const defaultDepartment = snapshot.departments[0] || "Physio";

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

  const [expensePayFrom, setExpensePayFrom] = useState<PaidFrom>("Reception");
  const [expensePayBusy, setExpensePayBusy] = useState<string | null>(null);
  const [expensePayStatus, setExpensePayStatus] = useState<string | null>(null);

  const selectedPatient = useMemo(
    () => snapshot.patients.find((patient) => patient.patientId === paymentPatientId),
    [snapshot.patients, paymentPatientId]
  );

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!paymentPatientId) return;
    setPaymentBusy(true);
    setPaymentStatus(null);
    try {
      const result = await postJson("/api/finance/payment", {
        patientId: paymentPatientId,
        amount: Number(paymentAmount || 0),
        discount: Number(paymentDiscount || 0),
        paymentMethod,
        sessions: Number(paymentSessions || 0),
        remarks: paymentNote,
        requestId: paymentRequestId,
      });
      setPaymentStatus(`✓ Receipt ${String(result.receiptNo || "created")} · Due ${bdt(Number(result.due || 0))}`);
      setPaymentAmount("");
      setPaymentDiscount("0");
      setPaymentSessions("0");
      setPaymentNote("");
      setPaymentRequestId(requestId());
      router.refresh();
    } catch (error) {
      setPaymentStatus(`✕ ${error instanceof Error ? error.message : "Payment failed"}`);
    } finally {
      setPaymentBusy(false);
    }
  }

  async function submitExpense(event: React.FormEvent) {
    event.preventDefault();
    setExpenseBusy(true);
    setExpenseStatus(null);
    try {
      const result = await postJson("/api/finance/expense/request", {
        department: expenseDepartment,
        category: expenseCategory,
        amount: Number(expenseAmount),
        note: expenseNote,
        expenseType,
        requestId: expenseRequestId,
      });
      setExpenseStatus(`✓ Expense ${String(result.expenseId || "requested")} · Owner approval pending`);
      setExpenseCategory("");
      setExpenseAmount("");
      setExpenseNote("");
      setExpenseType("Clinic Expense");
      setExpenseRequestId(requestId());
      router.refresh();
    } catch (error) {
      setExpenseStatus(`✕ ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setExpenseBusy(false);
    }
  }

  async function submitCash(event: React.FormEvent) {
    event.preventDefault();
    setCashBusy(true);
    setCashStatus(null);
    try {
      const result = await postJson("/api/finance/cash/request", {
        department: cashDepartment,
        amount: Number(cashAmount),
        toCustodian: cashTo,
        note: cashNote,
        requestId: cashRequestId,
      });
      setCashStatus(`✓ Movement ${String(result.movementId || "requested")} · acceptance pending`);
      setCashAmount("");
      setCashNote("");
      setCashRequestId(requestId());
      router.refresh();
    } catch (error) {
      setCashStatus(`✕ ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setCashBusy(false);
    }
  }

  async function submitSalary(event: React.FormEvent) {
    event.preventDefault();
    setSalaryBusy(true);
    setSalaryStatus(null);
    try {
      const result = await postJson("/api/finance/salary", {
        staffId: salaryStaffId,
        amount: Number(salaryAmount),
        paidFrom: salaryPaidFrom,
        note: salaryNote,
        pin: salaryPin,
        requestId: salaryRequestId,
      });
      setSalaryStatus(`✓ Salary ${String(result.paymentId || "paid")}`);
      setSalaryAmount("");
      setSalaryNote("");
      setSalaryPin("");
      setSalaryRequestId(requestId());
      router.refresh();
    } catch (error) {
      setSalaryStatus(`✕ ${error instanceof Error ? error.message : "Salary failed"}`);
    } finally {
      setSalaryBusy(false);
    }
  }

  async function payExpense(expenseId: string, department: Department) {
    setExpensePayBusy(expenseId);
    setExpensePayStatus(null);
    try {
      await postJson("/api/finance/expense/pay", {
        expenseId,
        department,
        paidFrom: expensePayFrom,
      });
      setExpensePayStatus(`✓ ${expenseId} paid from ${expensePayFrom}`);
      router.refresh();
    } catch (error) {
      setExpensePayStatus(`✕ ${error instanceof Error ? error.message : "Pay failed"}`);
    } finally {
      setExpensePayBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {snapshot.capabilities.paymentCreate && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Patient payment / session</h2>
          <p className="mt-1 text-xs text-slate-400">06_Payments + patient due এক transaction-এ update হবে।</p>
          <form onSubmit={submitPayment} className="mt-4 space-y-3">
            <div>
              <FieldLabel>Patient</FieldLabel>
              <select className={inputClass} value={paymentPatientId} onChange={(e) => setPaymentPatientId(e.target.value)} required>
                {snapshot.patients.map((patient) => (
                  <option key={`${patient.department}-${patient.patientId}`} value={patient.patientId}>
                    {patient.patientId} · {patient.fullName} · {patient.department} · Due {bdt(patient.due)}
                  </option>
                ))}
              </select>
              {selectedPatient && <p className="mt-1 text-[11px] text-slate-400">Current due: {bdt(selectedPatient.due)}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="0" step="1" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></div>
              <div><FieldLabel>Discount</FieldLabel><input className={inputClass} type="number" min="0" step="1" value={paymentDiscount} onChange={(e) => setPaymentDiscount(e.target.value)} /></div>
              <div><FieldLabel>Sessions</FieldLabel><input className={inputClass} type="number" min="0" step="1" value={paymentSessions} onChange={(e) => setPaymentSessions(e.target.value)} /></div>
              <div><FieldLabel>Method</FieldLabel><select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{["Cash", "bKash", "Nagad", "Bank", "Card"].map((item) => <option key={item}>{item}</option>)}</select></div>
            </div>
            <div><FieldLabel>Note / service</FieldLabel><input className={inputClass} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Optional" /></div>
            <button disabled={paymentBusy || !paymentPatientId} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{paymentBusy ? "Saving..." : "Save payment"}</button>
            <Status value={paymentStatus} />
          </form>
        </section>
      )}

      {snapshot.capabilities.expenseRequest && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Expense request</h2>
          <p className="mt-1 text-xs text-slate-400">Request → Owner approval → payment. Approval নিজে cash deduct করবে না।</p>
          <form onSubmit={submitExpense} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><FieldLabel>Department</FieldLabel><select className={inputClass} value={expenseDepartment} onChange={(e) => setExpenseDepartment(e.target.value as Department)}>{snapshot.departments.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="1" step="1" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} required /></div>
            </div>
            <div><FieldLabel>Category</FieldLabel><input className={inputClass} value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} placeholder="যেমন: Generator Petrol" required /></div>
            {snapshot.capabilities.householdWithdrawal && <div><FieldLabel>Type</FieldLabel><select className={inputClass} value={expenseType} onChange={(e) => setExpenseType(e.target.value)}><option>Clinic Expense</option><option>Household Withdrawal</option></select></div>}
            <div><FieldLabel>Note</FieldLabel><input className={inputClass} value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} placeholder="Optional" /></div>
            <button disabled={expenseBusy} className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{expenseBusy ? "Requesting..." : "Request expense"}</button>
            <Status value={expenseStatus} />
          </form>
        </section>
      )}

      {snapshot.capabilities.expensePay && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Approved expenses to pay</h2>
          <div className="mt-3"><FieldLabel>Pay from</FieldLabel><select className={inputClass} value={expensePayFrom} onChange={(e) => setExpensePayFrom(e.target.value as PaidFrom)}>{(snapshot.capabilities.householdWithdrawal ? ["Reception", "Home Treasury", "Bank"] : ["Reception"]).map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="mt-3 space-y-2">
            {snapshot.approvedExpenses.map((expense) => (
              <div key={`${expense.department}-${expense.id}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{expense.category}</p><p className="text-xs text-slate-400">{expense.id} · {expense.department} · {expense.date}</p></div><span className="text-sm font-semibold text-slate-900">{bdt(expense.amount)}</span></div>
                {expense.note && <p className="mt-1 text-xs text-slate-500">{expense.note}</p>}
                <button type="button" disabled={expensePayBusy === expense.id} onClick={() => payExpense(expense.id, expense.department)} className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{expensePayBusy === expense.id ? "Paying..." : "Mark paid"}</button>
              </div>
            ))}
            {snapshot.approvedExpenses.length === 0 && <p className="py-3 text-center text-xs text-slate-400">Approved কিন্তু unpaid expense নেই।</p>}
          </div>
          <Status value={expensePayStatus} />
        </section>
      )}

      {snapshot.capabilities.cashRequest && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Reception cash handover</h2>
          <p className="mt-1 text-xs text-slate-400">Reception → Home Treasury/Bank transfer; expense নয়।</p>
          <form onSubmit={submitCash} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3"><div><FieldLabel>Department</FieldLabel><select className={inputClass} value={cashDepartment} onChange={(e) => setCashDepartment(e.target.value as Department)}>{snapshot.departments.map((d) => <option key={d}>{d}</option>)}</select></div><div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="1" step="1" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} required /></div></div>
            <div><FieldLabel>To</FieldLabel><select className={inputClass} value={cashTo} onChange={(e) => setCashTo(e.target.value)}><option>Home Treasury</option><option>Bank</option></select></div>
            <div><FieldLabel>Note</FieldLabel><input className={inputClass} value={cashNote} onChange={(e) => setCashNote(e.target.value)} placeholder="Optional" /></div>
            <button disabled={cashBusy} className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{cashBusy ? "Requesting..." : "Request handover"}</button>
            <Status value={cashStatus} />
          </form>
        </section>
      )}

      {snapshot.capabilities.salaryPay && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Salary / advance payment</h2>
          <p className="mt-1 text-xs text-slate-400">Owner-only write; PIN required.</p>
          <form onSubmit={submitSalary} className="mt-4 space-y-3">
            <div><FieldLabel>Staff</FieldLabel><select className={inputClass} value={salaryStaffId} onChange={(e) => setSalaryStaffId(e.target.value)}>{snapshot.staff.map((staff) => <option key={staff.staffId} value={staff.staffId}>{staff.staffId} · {staff.fullName} · {staff.department}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3"><div><FieldLabel>Amount</FieldLabel><input className={inputClass} type="number" min="1" step="1" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} required /></div><div><FieldLabel>Paid from</FieldLabel><select className={inputClass} value={salaryPaidFrom} onChange={(e) => setSalaryPaidFrom(e.target.value as PaidFrom)}><option>Home Treasury</option><option>Reception</option><option>Bank</option></select></div></div>
            <div><FieldLabel>Note</FieldLabel><input className={inputClass} value={salaryNote} onChange={(e) => setSalaryNote(e.target.value)} placeholder="Advance / reason" /></div>
            <div><FieldLabel>Owner PIN</FieldLabel><input className={inputClass} type="password" inputMode="numeric" maxLength={6} value={salaryPin} onChange={(e) => setSalaryPin(e.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>
            <button disabled={salaryBusy || !salaryStaffId} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{salaryBusy ? "Saving..." : "Pay salary / advance"}</button>
            <Status value={salaryStatus} />
          </form>
        </section>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">Recent payments</h2>
        <div className="mt-3 space-y-2">
          {snapshot.recentPayments.map((payment) => (
            <div key={`${payment.department}-${payment.receiptNo}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-800">{payment.patientName || payment.patientId}</p><p className="text-[11px] text-slate-400">{payment.receiptNo} · {payment.department} · {payment.date} · {payment.method}</p></div><span className="shrink-0 text-xs font-semibold text-slate-900">{bdt(payment.amount)}</span></div>
          ))}
          {snapshot.recentPayments.length === 0 && <p className="py-3 text-center text-xs text-slate-400">Payment history নেই।</p>}
        </div>
      </section>
    </div>
  );
}
