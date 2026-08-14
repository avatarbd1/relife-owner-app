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
  Department,
  CashBucket,
} from "@/lib/types";

/**
 * READ-ONLY DATA SERVICE LAYER
 * ------------------------------------------------------------------
 * Stage A: seed JSON files under /data/seed.
 *
 * Stage B (current): fetch from live Google Sheets CSV exports.
 * Each sheet tab is published to web as CSV. The functions below
 * parse the CSV and return typed data that exactly matches the
 * Stage A contract, so no UI code changes are needed.
 *
 * Sheet URLs: Set these in .env.local as CSV export links from
 * your published Relife_Clinic_OS_Database_Template_FIXED (Physio)
 * and Relife Dental OS (Dental) workbooks:
 *   - SHEET_PAYMENTS_CSV=https://docs.google.com/.../export?format=csv
 *   - SHEET_EXPENSES_CSV=https://docs.google.com/.../export?format=csv
 *   - SHEET_STAFF_CSV=https://docs.google.com/.../export?format=csv
 *   - SHEET_SALARY_CSV=https://docs.google.com/.../export?format=csv
 *   - SHEET_CASH_CSV=https://docs.google.com/.../export?format=csv
 *
 * When IS_LIVE_DATA is false, falls back to seed data (dev/testing).
 * ------------------------------------------------------------------
 */

export const IS_LIVE_DATA = process.env.SHEET_PAYMENTS_CSV ? true : false;

async function fetchAndParseCSV(url: string): Promise<string[][]> {
  const response = await fetch(url, {
    cache: "no-store", // Always fetch fresh data
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch CSV: ${response.status} ${response.statusText}`
    );
  }
  const text = await response.text();
  const lines = text.trim().split("\n");
  return lines.map((line) => {
    // Simple CSV parsing: split by comma, handle quoted values
    const row: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    return row;
  });
}

function getHeaderIndex(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const idx = headers.findIndex(
      (h) => h.toLowerCase() === name.toLowerCase()
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function parsePaymentsCSV(rows: string[][]): Payment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];

  const receiptNoIdx = getHeaderIndex(headers, "receiptNo", "receipt_no");
  const dateIdx = getHeaderIndex(headers, "date");
  const patientIdIdx = getHeaderIndex(headers, "patientId", "patient_id");
  const patientNameIdx = getHeaderIndex(headers, "patientName", "patient_name");
  const departmentIdx = getHeaderIndex(headers, "department");
  const amountIdx = getHeaderIndex(headers, "amount");
  const discountIdx = getHeaderIndex(headers, "discount");
  const dueIdx = getHeaderIndex(headers, "due");
  const paymentMethodIdx = getHeaderIndex(
    headers,
    "paymentMethod",
    "payment_method"
  );
  const receivedByIdx = getHeaderIndex(headers, "receivedBy", "received_by");
  const remarksIdx = getHeaderIndex(headers, "remarks");

  return rows.slice(1).map((row) => {
    const payment: Payment = {
      receiptNo: row[receiptNoIdx] || "",
      date: row[dateIdx] || "",
      patientId: row[patientIdIdx] || "",
      patientName: row[patientNameIdx] || "",
      department: (row[departmentIdx] || "Physio") as Department,
      amount: parseFloat(row[amountIdx] || "0"),
      discount: parseFloat(row[discountIdx] || "0"),
      due: parseFloat(row[dueIdx] || "0"),
      paymentMethod: (row[paymentMethodIdx] || "Cash") as
        | "Cash"
        | "bKash"
        | "Bank"
        | "Nagad"
        | "Card",
      receivedBy: row[receivedByIdx] || "",
    };
    if (remarksIdx >= 0 && row[remarksIdx]) {
      payment.remarks = row[remarksIdx];
    }
    return payment;
  });
}

function parseExpensesCSV(rows: string[][]): Expense[] {
  if (rows.length < 2) return [];
  const headers = rows[0];

  const expenseIdIdx = getHeaderIndex(headers, "expenseId", "expense_id");
  const dateIdx = getHeaderIndex(headers, "date");
  const categoryIdx = getHeaderIndex(headers, "category");
  const descriptionIdx = getHeaderIndex(headers, "description");
  const amountIdx = getHeaderIndex(headers, "amount");
  const paymentMethodIdx = getHeaderIndex(
    headers,
    "paymentMethod",
    "payment_method"
  );
  const paidByIdx = getHeaderIndex(headers, "paidBy", "paid_by");
  const departmentIdx = getHeaderIndex(headers, "department");
  const isHouseholdIdx = getHeaderIndex(
    headers,
    "isHouseholdWithdrawal",
    "is_household_withdrawal"
  );

  return rows.slice(1).map((row) => ({
    expenseId: row[expenseIdIdx] || "",
    date: row[dateIdx] || "",
    category: row[categoryIdx] || "",
    description: row[descriptionIdx] || "",
    amount: parseFloat(row[amountIdx] || "0"),
    paymentMethod: row[paymentMethodIdx] || "",
    paidBy: row[paidByIdx] || "",
    department: (row[departmentIdx] || "Physio") as Department,
    isHouseholdWithdrawal: (row[isHouseholdIdx] || "").toLowerCase() === "true",
  }));
}

function parseStaffCSV(rows: string[][]): StaffMember[] {
  if (rows.length < 2) return [];
  const headers = rows[0];

  const staffIdIdx = getHeaderIndex(headers, "staffId", "staff_id");
  const fullNameIdx = getHeaderIndex(headers, "fullName", "full_name");
  const phoneIdx = getHeaderIndex(headers, "phone");
  const roleIdx = getHeaderIndex(headers, "role");
  const departmentIdx = getHeaderIndex(headers, "department");
  const salaryIdx = getHeaderIndex(headers, "salary");
  const statusIdx = getHeaderIndex(headers, "status");

  return rows.slice(1).map((row) => {
    const member: StaffMember = {
      staffId: row[staffIdIdx] || "",
      fullName: row[fullNameIdx] || "",
      role: row[roleIdx] || "",
      department: (row[departmentIdx] || "Physio") as Department,
      salary: parseFloat(row[salaryIdx] || "0"),
      status: (row[statusIdx] || "Active") as "Active" | "Inactive",
    };
    if (phoneIdx >= 0 && row[phoneIdx]) {
      member.phone = row[phoneIdx];
    }
    return member;
  });
}

function parseSalaryPaymentsCSV(rows: string[][]): SalaryPayment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];

  const idIdx = getHeaderIndex(headers, "id");
  const dateIdx = getHeaderIndex(headers, "date");
  const staffIdIdx = getHeaderIndex(headers, "staffId", "staff_id");
  const staffNameIdx = getHeaderIndex(headers, "staffName", "staff_name");
  const departmentIdx = getHeaderIndex(headers, "department");
  const amountIdx = getHeaderIndex(headers, "amount");
  const typeIdx = getHeaderIndex(headers, "type");

  return rows.slice(1).map((row) => ({
    id: row[idIdx] || "",
    date: row[dateIdx] || "",
    staffId: row[staffIdIdx] || "",
    staffName: row[staffNameIdx] || "",
    department: (row[departmentIdx] || "Physio") as Department,
    amount: parseFloat(row[amountIdx] || "0"),
    type: (row[typeIdx] || "Salary") as "Salary" | "Advance",
  }));
}

function parseCashMovementsCSV(rows: string[][]): CashMovement[] {
  if (rows.length < 2) return [];
  const headers = rows[0];

  const idIdx = getHeaderIndex(headers, "id");
  const dateIdx = getHeaderIndex(headers, "date");
  const bucketIdx = getHeaderIndex(headers, "bucket");
  const amountIdx = getHeaderIndex(headers, "amount");
  const remarksIdx = getHeaderIndex(headers, "remarks");

  return rows.slice(1).map((row) => {
    const movement: CashMovement = {
      id: row[idIdx] || "",
      date: row[dateIdx] || "",
      bucket: (row[bucketIdx] || "Bank") as CashBucket,
      amount: parseFloat(row[amountIdx] || "0"),
    };
    if (remarksIdx >= 0 && row[remarksIdx]) {
      movement.remarks = row[remarksIdx];
    }
    return movement;
  });
}

export async function getPayments(): Promise<Payment[]> {
  if (!IS_LIVE_DATA) return paymentsSeed as Payment[];

  try {
    const url = process.env.SHEET_PAYMENTS_CSV!;
    const rows = await fetchAndParseCSV(url);
    return parsePaymentsCSV(rows);
  } catch (error) {
    console.error("Error fetching payments:", error);
    return paymentsSeed as Payment[];
  }
}

export async function getExpenses(): Promise<Expense[]> {
  if (!IS_LIVE_DATA) return expensesSeed as Expense[];

  try {
    const url = process.env.SHEET_EXPENSES_CSV!;
    const rows = await fetchAndParseCSV(url);
    return parseExpensesCSV(rows);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    return expensesSeed as Expense[];
  }
}

export async function getStaff(): Promise<StaffMember[]> {
  if (!IS_LIVE_DATA) return staffSeed as StaffMember[];

  try {
    const url = process.env.SHEET_STAFF_CSV!;
    const rows = await fetchAndParseCSV(url);
    return parseStaffCSV(rows);
  } catch (error) {
    console.error("Error fetching staff:", error);
    return staffSeed as StaffMember[];
  }
}

export async function getSalaryPayments(): Promise<SalaryPayment[]> {
  if (!IS_LIVE_DATA) return salaryPaymentsSeed as SalaryPayment[];

  try {
    const url = process.env.SHEET_SALARY_CSV!;
    const rows = await fetchAndParseCSV(url);
    return parseSalaryPaymentsCSV(rows);
  } catch (error) {
    console.error("Error fetching salary payments:", error);
    return salaryPaymentsSeed as SalaryPayment[];
  }
}

export async function getCashMovements(): Promise<CashMovement[]> {
  if (!IS_LIVE_DATA) return cashMovementsSeed as CashMovement[];

  try {
    const url = process.env.SHEET_CASH_CSV!;
    const rows = await fetchAndParseCSV(url);
    return parseCashMovementsCSV(rows);
  } catch (error) {
    console.error("Error fetching cash movements:", error);
    return cashMovementsSeed as CashMovement[];
  }
}
