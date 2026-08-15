import "server-only";

import { getCashMovements, getExpenses, getSalaryPayments } from "@/lib/data";
import type { Department, Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";

type ClinicDepartment = "Physio" | "Dental";

function asClinicDepartment(value: Department): ClinicDepartment | null {
  return value === "Physio" || value === "Dental" ? value : null;
}

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return department === (scope === "physio" ? "Physio" : "Dental");
}

export async function getFinanceHistorySnapshot(
  context: AccessContext,
  scope: Scope
) {
  const [expenses, cashMovements, salaryPayments] = await Promise.all([
    getExpenses(),
    getCashMovements(),
    getSalaryPayments(),
  ]);

  const visibleExpenses = expenses
    .flatMap((row) => {
      const department = asClinicDepartment(row.department);
      if (!department) return [];
      if (!scopeAllows(scope, department)) return [];
      if (!canPerform(context, "expense.read", department)) return [];
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
    rejectedExpenses: visibleExpenses.filter((row) => row.status.toLowerCase() === "rejected"),
    cashMovements: visibleCash,
    salaryPayments: visibleSalary,
    capabilities: {
      expenseHistory: visibleExpenses.length > 0 || ["Physio", "Dental"].some((d) =>
        scopeAllows(scope, d as ClinicDepartment) &&
        canPerform(context, "expense.read", d as ClinicDepartment)
      ),
      cashHistory: visibleCash.length > 0 || ["Physio", "Dental"].some((d) =>
        scopeAllows(scope, d as ClinicDepartment) &&
        canPerform(context, "cash.read", d as ClinicDepartment)
      ),
      salaryHistory: visibleSalary.length > 0 || ["Physio", "Dental"].some((d) =>
        scopeAllows(scope, d as ClinicDepartment) &&
        canPerform(context, "salary.read", d as ClinicDepartment)
      ),
    },
  };
}
