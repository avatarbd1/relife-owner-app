// Core domain types for the Relife Owner Web App.
// These mirror the data contract described in the project spec:
//   06_Payments -> Payment
//   07_Expenses -> Expense
//   08_Staff    -> Staff
//   13_Salary   -> SalaryPayment
//   21_Cash_Movement -> CashMovement

export type Department = "Physio" | "Dental";
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
  /**
   * Household withdrawals are tracked in 07_Expenses but must NOT be counted
   * as a clinic business expense in cost-recovery / liability calculations.
   */
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
  type: "Salary" | "Advance";
}

export type CashBucket = "Reception" | "HomeTreasury" | "Bank";

export interface CashMovement {
  id: string;
  date: string; // YYYY-MM-DD
  bucket: CashBucket;
  /** Positive = inflow to this bucket, Negative = outflow from this bucket */
  amount: number;
  remarks?: string;
}
