import "server-only";

import type { Department, Scope } from "@/lib/types";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import type { FinanceOperationsSnapshot } from "@/lib/webos/financeOps";
import { getVisiblePatients } from "@/lib/webos/reception";
import { listTenantScopedWebStaffDirectory } from "@/lib/webos/tenantStaffDirectory";
import {
  readTenantExpenses,
  readTenantPayments,
  type FinanceTenantContext,
} from "@/lib/webos/tenantFinanceData";

type ClinicDepartment = "Physio" | "Dental";

function scopeAllows(scope: Scope, department: ClinicDepartment): boolean {
  if (scope === "combined") return true;
  return scope === "physio" ? department === "Physio" : department === "Dental";
}

export async function getTenantFinanceOperationsSnapshot(
  context: AccessContext,
  scope: Scope,
  tenant: FinanceTenantContext
): Promise<FinanceOperationsSnapshot> {
  const allowedDepartments = (["Physio", "Dental"] as ClinicDepartment[]).filter(
    (department) =>
      scopeAllows(scope, department) &&
      (canPerform(context, "payment.create", department) ||
        canPerform(context, "expense.request", department) ||
        canPerform(context, "expense.pay", department) ||
        canPerform(context, "cash.request", department) ||
        canPerform(context, "salary.pay", department))
  );

  const [visiblePatients, directory, payments, expenses] = await Promise.all([
    getVisiblePatients(context, scope, tenant.organizationId, tenant.clinicId),
    listTenantScopedWebStaffDirectory(tenant),
    readTenantPayments(tenant, scope),
    readTenantExpenses(tenant, scope),
  ]);

  const patients = visiblePatients.flatMap((patient) => {
    if (patient.department !== "Physio" && patient.department !== "Dental") return [];
    if (!canPerform(context, "payment.create", patient.department)) return [];
    return [{
      patientId: patient.patientId,
      fullName: patient.fullName,
      department: patient.department,
      due: patient.due,
    }];
  });

  const staff = directory.flatMap((item) => {
    if (item.status !== "Active" || !item.primaryDepartment) return [];
    const department: Department = item.primaryDepartment;
    if (
      department !== "All" &&
      department !== "Physio" &&
      department !== "Dental"
    ) return [];
    if (department !== "All" && !scopeAllows(scope, department)) return [];
    return [{
      staffId: item.staffId,
      fullName: item.fullName,
      department,
      salary: 0,
    }];
  });

  const approvedExpenses = expenses.flatMap((expense) => {
    const department = expense.department;
    if (department !== "Physio" && department !== "Dental") return [];
    if (!scopeAllows(scope, department)) return [];
    if (!canPerform(context, "expense.pay", department)) return [];
    if (String(expense.status || "").trim().toLowerCase() !== "approved") return [];
    return [{
      id: expense.expenseId,
      department,
      date: expense.date,
      category: expense.category,
      amount: expense.amount,
      note: expense.description || "",
      requestedBy: expense.paidBy || "",
    }];
  });

  const recentPayments = payments
    .flatMap((payment) => {
      if (payment.department !== "Physio" && payment.department !== "Dental") return [];
      if (!scopeAllows(scope, payment.department)) return [];
      if (!canPerform(context, "payment.read_amount", payment.department)) return [];
      return [{
        receiptNo: payment.receiptNo,
        date: payment.date,
        patientId: payment.patientId,
        patientName: payment.patientName,
        department: payment.department,
        amount: payment.amount,
        method: payment.paymentMethod,
      }];
    })
    .sort((a, b) => `${b.date}|${b.receiptNo}`.localeCompare(`${a.date}|${a.receiptNo}`))
    .slice(0, 12);

  const any = (
    action: "payment.create" | "expense.request" | "expense.pay" | "cash.request" | "salary.pay"
  ) => allowedDepartments.some((department) => canPerform(context, action, department));

  return {
    patients,
    staff,
    approvedExpenses,
    recentPayments,
    departments: allowedDepartments,
    capabilities: {
      paymentCreate: any("payment.create"),
      expenseRequest: any("expense.request"),
      expensePay: any("expense.pay"),
      cashRequest: any("cash.request"),
      salaryPay: any("salary.pay"),
      householdWithdrawal: context.roles.includes("Owner"),
    },
  };
}
