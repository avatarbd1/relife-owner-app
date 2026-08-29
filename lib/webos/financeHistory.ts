import "server-only";

import type { Department, Scope } from "@/lib/types";
import { canPerform, type AccessContext, type WebAction } from "@/lib/webos/access";
import {
  readTenantCashMovements,
  readTenantExpenses,
  readTenantSalaryPayments,
  type FinanceTenantContext,
} from "@/lib/webos/tenantFinanceData";

type ClinicDepartment = "Physio" | "Dental";

function asClinicDepartment(value: Department): ClinicDepartment | null {
  return value === "Physio" || value === "Dental" ? value : null;
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isReceptionFinanceLimited(context: AccessContext): boolean {
  return (
    context.roles.includes("Receptionist") &&
    !context.roles.some((role) => ["Owner", "Manager", "Auditor"].includes(role))
  );
}

function canAny(context: AccessContext, scope: Scope, action: WebAction): boolean {
  return (["Physio", "Dental"] as ClinicDepartment[]).some(
    (department) => scopeAllows(scope, department) && canPerform(context, action, department)
  );
}

export async function getFinanceHistorySnapshot(
  context: AccessContext,
  scope: Scope,
  tenant: FinanceTenantContext
) {
  const receptionLimited = isReceptionFinanceLimited(context);
  const needsExpenses = receptionLimited || canAny(context, scope, "expense.read");
  const needsCash = canAny(context, scope, "cash.read");
  const needsSalary = !receptionLimited && canAny(context, scope, "salary.read");

  const [expenses, cashMovements, salaryPayments] = await Promise.all([
    needsExpenses ? readTenantExpenses(tenant, scope) : Promise.resolve([]),
    needsCash ? readTenantCashMovements(tenant, scope) : Promise.resolve([]),
    needsSalary ? readTenantSalaryPayments(tenant, scope) : Promise.resolve([]),
  ]);

  const visibleExpenses = expenses
    .flatMap((row) => {
      const department = asClinicDepartment(row.department);
      if (!department) return [];
      if (!scopeAllows(scope, department)) return [];

      if (receptionLimited) {
        if (!canPerform(context, "cash.read", department)) return [];
        const paidFrom = normalize(row.paidFrom || row.paymentMethod);
        if (paidFrom !== "reception") return [];
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
      const department = asClinicDepartment(row.department);
      if (!department) return [];
      if (!scopeAllows(scope, department)) return [];
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

  const visibleSalary = receptionLimited
    ? []
    : salaryPayments
        .flatMap((row) => {
          const department = asClinicDepartment(row.department);
          if (!department) return [];
          if (!scopeAllows(scope, department)) return [];
          if (!canPerform(context, "salary.read", department)) return [];
          return [{
            id: row.id,
            date: row.date,
            department,
            staffId: row.staffId,
            staffName: row.staffName || "",
            amount: row.amount,
            type: row.type,
            paidFrom: row.paidFrom || "",
            status: row.status || "Recorded",
            paidAt: row.paidAt || "",
          }];
        })
        .sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));

  return {
    expenses: visibleExpenses,
    rejectedExpenses: receptionLimited
      ? []
      : visibleExpenses.filter((row) => row.status.toLowerCase() === "rejected"),
    cashMovements: visibleCash,
    salaryPayments: visibleSalary,
    capabilities: {
      receptionLimited,
      expenseHistory: receptionLimited
        ? true
        : visibleExpenses.length > 0 || canAny(context, scope, "expense.read"),
      cashHistory: visibleCash.length > 0 || canAny(context, scope, "cash.read"),
      salaryHistory: receptionLimited
        ? false
        : visibleSalary.length > 0 || canAny(context, scope, "salary.read"),
    },
  };
}
