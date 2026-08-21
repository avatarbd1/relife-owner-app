import "server-only";

import { getCashMovements, getExpenses, getPayments, getSalaryPayments } from "@/lib/data";
import type { Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";

type ClinicDepartment = "Physio" | "Dental";

export type FinanceLedgerKind =
  | "daily-collection"
  | "collection-history"
  | "expense-history"
  | "cash-history"
  | "salary-history"
  | "audit";

export interface CollectionLedgerRow {
  receiptNo: string;
  date: string;
  patientId: string;
  patientName: string;
  department: ClinicDepartment;
  amount: number;
  discount: number;
  due: number;
  method: string;
  receivedBy: string;
}

export interface ExpenseLedgerRow {
  expenseId: string;
  date: string;
  department: ClinicDepartment;
  category: string;
  description: string;
  amount: number;
  status: string;
  expenseType: string;
  paidFrom: string;
  paidBy: string;
  paidAt: string;
  isHouseholdWithdrawal: boolean;
}

export interface CashLedgerRow {
  id: string;
  date: string;
  department: ClinicDepartment;
  fromCustodian: string;
  toCustodian: string;
  amount: number;
  receivedAmount?: number;
  status: string;
  remarks: string;
}

export interface SalaryLedgerRow {
  id: string;
  date: string;
  department: ClinicDepartment;
  staffId: string;
  staffName: string;
  amount: number;
  type: string;
  paidFrom: string;
  status: string;
  paidAt: string;
}

export interface FinanceLedgerSnapshot {
  today: string;
  scope: Scope;
  collections: CollectionLedgerRow[];
  expenses: ExpenseLedgerRow[];
  cashMovements: CashLedgerRow[];
  salaryPayments: SalaryLedgerRow[];
  capabilities: {
    receptionLimited: boolean;
    collections: boolean;
    expenses: boolean;
    cash: boolean;
    salary: boolean;
    audit: boolean;
  };
}

function asDepartment(value: string): ClinicDepartment | null {
  if (value === "Physio" || value === "Dental") return value;
  return null;
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isReceptionLimited(context: AccessContext): boolean {
  return (
    context.roles.includes("Receptionist") &&
    !context.roles.some((role) => ["Owner", "Manager", "Auditor"].includes(role))
  );
}

function departmentsInScope(scope: Scope): ClinicDepartment[] {
  if (scope === "physio") return ["Physio"];
  if (scope === "dental") return ["Dental"];
  return ["Physio", "Dental"];
}

function canReadCollection(context: AccessContext, department: ClinicDepartment): boolean {
  return (
    canPerform(context, "payment.read_amount", department) ||
    canPerform(context, "report.read_financial", department)
  );
}

function anyInScope(
  context: AccessContext,
  scope: Scope,
  predicate: (department: ClinicDepartment) => boolean
): boolean {
  return departmentsInScope(scope).some(
    (department) => predicate(department) && scopeAllows(scope, department)
  );
}

function dhakaDate(ref = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function canOpenFinanceLedger(
  snapshot: FinanceLedgerSnapshot,
  kind: FinanceLedgerKind
): boolean {
  if (kind === "daily-collection" || kind === "collection-history") {
    return snapshot.capabilities.collections;
  }
  if (kind === "expense-history") return snapshot.capabilities.expenses;
  if (kind === "cash-history") return snapshot.capabilities.cash;
  if (kind === "salary-history") return snapshot.capabilities.salary;
  return snapshot.capabilities.audit;
}

export async function getFinanceLedgerSnapshot(
  context: AccessContext,
  scope: Scope
): Promise<FinanceLedgerSnapshot> {
  const receptionLimited = isReceptionLimited(context);
  const collectionsAllowed = anyInScope(context, scope, (department) =>
    canReadCollection(context, department)
  );
  const expensesAllowed = receptionLimited
    ? anyInScope(context, scope, (department) => canPerform(context, "cash.read", department))
    : anyInScope(context, scope, (department) => canPerform(context, "expense.read", department));
  const cashAllowed = anyInScope(context, scope, (department) =>
    canPerform(context, "cash.read", department)
  );
  const salaryAllowed = !receptionLimited && anyInScope(context, scope, (department) =>
    canPerform(context, "salary.read", department)
  );
  const auditAllowed = context.roles.some((role) => role === "Owner" || role === "Auditor");

  const [payments, expenses, cashMovements, salaryPayments] = await Promise.all([
    collectionsAllowed ? getPayments() : Promise.resolve([]),
    expensesAllowed ? getExpenses() : Promise.resolve([]),
    cashAllowed ? getCashMovements() : Promise.resolve([]),
    salaryAllowed ? getSalaryPayments() : Promise.resolve([]),
  ]);

  const visibleCollections = payments
    .flatMap((row) => {
      const department = asDepartment(row.department);
      if (!department || !scopeAllows(scope, department)) return [];
      if (!canReadCollection(context, department)) return [];
      return [{
        receiptNo: row.receiptNo,
        date: row.date,
        patientId: row.patientId,
        patientName: row.patientName,
        department,
        amount: row.amount,
        discount: row.discount,
        due: row.due,
        method: row.paymentMethod,
        receivedBy: row.receivedBy,
      }];
    })
    .sort((a, b) => `${b.date}|${b.receiptNo}`.localeCompare(`${a.date}|${a.receiptNo}`));

  const visibleExpenses = expenses
    .flatMap((row) => {
      const department = asDepartment(row.department);
      if (!department || !scopeAllows(scope, department)) return [];
      if (receptionLimited) {
        if (!canPerform(context, "cash.read", department)) return [];
        if (normalize(row.paidFrom || row.paymentMethod) !== "reception") return [];
      } else if (!canPerform(context, "expense.read", department)) {
        return [];
      }
      return [{
        expenseId: row.expenseId,
        date: row.date,
        department,
        category: row.category,
        description: row.description,
        amount: row.amount,
        status: row.status || "Recorded",
        expenseType: row.expenseType || "Clinic Expense",
        paidFrom: row.paidFrom || row.paymentMethod || "",
        paidBy: row.paidBy || "",
        paidAt: row.paidAt || "",
        isHouseholdWithdrawal: Boolean(row.isHouseholdWithdrawal),
      }];
    })
    .sort((a, b) => `${b.date}|${b.expenseId}`.localeCompare(`${a.date}|${a.expenseId}`));

  const visibleCash = cashMovements
    .flatMap((row) => {
      const department = asDepartment(row.department);
      if (!department || !scopeAllows(scope, department)) return [];
      if (!canPerform(context, "cash.read", department)) return [];
      if (receptionLimited && normalize(row.fromCustodian) !== "reception") return [];
      return [{
        id: row.id,
        date: row.date,
        department,
        fromCustodian: row.fromCustodian,
        toCustodian: row.toCustodian,
        amount: row.amount,
        receivedAmount: row.receivedAmount,
        status: row.status || "Recorded",
        remarks: row.remarks || "",
      }];
    })
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));

  const visibleSalary = salaryPayments
    .flatMap((row) => {
      const department = asDepartment(row.department);
      if (!department || !scopeAllows(scope, department)) return [];
      if (!canPerform(context, "salary.read", department)) return [];
      return [{
        id: row.id,
        date: row.date,
        department,
        staffId: row.staffId,
        staffName: row.staffName || "",
        amount: row.amount,
        type: row.type || "Type unavailable",
        paidFrom: row.paidFrom || "",
        status: row.status || "Recorded",
        paidAt: row.paidAt || "",
      }];
    })
    .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));

  return {
    today: dhakaDate(),
    scope,
    collections: visibleCollections,
    expenses: visibleExpenses,
    cashMovements: visibleCash,
    salaryPayments: visibleSalary,
    capabilities: {
      receptionLimited,
      collections: collectionsAllowed,
      expenses: expensesAllowed,
      cash: cashAllowed,
      salary: salaryAllowed,
      audit: auditAllowed,
    },
  };
}
