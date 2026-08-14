import "server-only";
import paymentsSeed from "@/data/seed/payments.json";
import expensesSeed from "@/data/seed/expenses.json";
import staffSeed from "@/data/seed/staff.json";
import salaryPaymentsSeed from "@/data/seed/salaryPayments.json";
import cashMovementsSeed from "@/data/seed/cashMovements.json";
import type {
  Payment,
  Expense,
  StaffMember,
  SalaryPayment,
  CashMovement,
} from "@/lib/types";

/**
 * READ-ONLY DATA SERVICE LAYER
 * ------------------------------------------------------------------
 * Stage A (current): every function below returns data from local
 * seed JSON files under /data/seed. The seed data mirrors the real
 * sheet schema (06_Payments, 07_Expenses, 08_Staff, 13_Salary,
 * 21_Cash_Movement) but the numbers are illustrative placeholders,
 * NOT live figures from the Relife Clinic OS / Relife Dental OS
 * Google Sheets.
 *
 * Stage B: swap the implementation of these functions to fetch from
 * the live Google Sheets (via the Google Sheets API + a service
 * account, or published-CSV endpoints) and reconcile each card
 * against the existing Sheet/Bot calculations before shipping.
 * The function signatures below are the contract the UI depends on,
 * so Stage B should not need to touch any page/component code.
 * ------------------------------------------------------------------
 */

export const IS_LIVE_DATA = false;

export async function getPayments(): Promise<Payment[]> {
  return paymentsSeed as Payment[];
}

export async function getExpenses(): Promise<Expense[]> {
  return expensesSeed as Expense[];
}

export async function getStaff(): Promise<StaffMember[]> {
  return staffSeed as StaffMember[];
}

export async function getSalaryPayments(): Promise<SalaryPayment[]> {
  return salaryPaymentsSeed as SalaryPayment[];
}

export async function getCashMovements(): Promise<CashMovement[]> {
  return cashMovementsSeed as CashMovement[];
}
