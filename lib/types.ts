// Core domain types for the Relife Owner Web App.
// These mirror the live Google Sheets finance contract.

export type Department = "Physio" | "Dental" | "All";
export type Scope = "combined" | "physio" | "dental";

export interface Payment {
  receiptNo: string;
  date: string; // YYYY-MM-DD
  patientId: string;
  patientName: string;
  department: Department;
  amount: number;
  discount: number;
  due: number;
  paymentMethod: "Cash" | "bKash" | "Bank" | "Nagad" | "Card";
  receivedBy: string;
  remarks?: string;
}

export interface Expense {
  expenseId: string;
  date: string; // YYYY-MM-DD
  category: string;
  description: string;
  amount: number;
  paymentMethod: string;
  paidBy: string;
  department: Department;
  /** Clinic Expense vs Household Withdrawal from 07_Expenses.Type. */
  expenseType?: string;
  /** Cash custodian used for the payment (Reception/Home Treasury/Bank). */
  paidFrom?: string;
  status?: string;
  paidAt?: string;
  isHouseholdWithdrawal: boolean;
}

export interface StaffMember {
  staffId: string;
  fullName: string;
  phone?: string;
  role: string;
  department: Department;
  /** Fixed monthly salary commitment, from 08_Staff.Salary */
  salary: number;
  status: "Active" | "Inactive";
}

export interface SalaryPayment {
  id: string;
  date: string; // YYYY-MM-DD
  staffId: string;
  staffName: string;
  department: Department;
  amount: number;
  type: "Salary" | "Advance" | "Unknown";
  paidFrom?: string;
  status?: string;
  paidAt?: string;
}

export interface CashMovement {
  id: string;
  date: string; // YYYY-MM-DD
  fromCustodian: string;
  toCustodian: string;
  amount: number;
  /** If receiving side confirms a different amount, this is the cash effect. */
  receivedAmount?: number;
  status: string;
  department: Department;
  remarks?: string;
}
