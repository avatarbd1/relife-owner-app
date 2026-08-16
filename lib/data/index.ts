import "server-only";
import paymentsSeed from "@/data/seed/payments.json";
import expensesSeed from "@/data/seed/expenses.json";
import staffSeed from "@/data/seed/staff.json";
import salaryPaymentsSeed from "@/data/seed/salaryPayments.json";
import cashMovementsSeed from "@/data/seed/cashMovements.json";
import {
  fetchSheetRanges,
  hasPrivateSheetsCredentials,
} from "@/lib/data/googleSheets";
import type {
  Payment,
  Expense,
  StaffMember,
  SalaryPayment,
  CashMovement,
  Department,
} from "@/lib/types";

/**
 * DATA SERVICE LAYER
 *
 * Production: private Google Sheets API reads using the same service account
 * that is shared on the Relife workbooks. No clinic sheet needs to be
 * published to the public web.
 *
 * Safety rule: when private live data is configured, a failed read must never
 * be replaced by seed/demo clinic records. The lower Sheets adapter may return
 * an explicitly time-bounded last-known-good cache; otherwise this layer fails
 * closed and lets the dashboard error boundary show a retry state.
 *
 * Compatibility fallback: the old SHEET_*_CSV variables are still supported
 * for non-private legacy/development setups.
 */

export const IS_LIVE_DATA =
  hasPrivateSheetsCredentials() || Boolean(process.env.SHEET_PAYMENTS_CSV);

const LIVE_RANGES = [
  "06_Payments",
  "07_Expenses",
  "08_Staff",
  "13_Salary",
  "21_Cash_Movement",
] as const;

type LiveSnapshot = {
  payments: Payment[];
  expenses: Expense[];
  staff: StaffMember[];
  salaryPayments: SalaryPayment[];
  cashMovements: CashMovement[];
};

let snapshotCache:
  | { createdAt: number; promise: Promise<LiveSnapshot> }
  | undefined;
const SNAPSHOT_TTL_MS = 3_000;

function money(value: string | undefined): number {
  const cleaned = String(value ?? "")
    .replace(/৳/g, "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number.parseFloat(cleaned || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function getHeaderIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((h) => String(h || "").trim().toLowerCase());
  for (const name of names) {
    const idx = normalized.indexOf(name.trim().toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function parseDepartment(value: string, fallback: Department): Department {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dental") return "Dental";
  if (normalized === "physio") return "Physio";
  if (normalized === "all") return "All";
  return fallback;
}

function parsePayments(rows: string[][], fallback: Department): Payment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const receiptNoIdx = getHeaderIndex(headers, "Receipt_No", "receiptNo");
  const dateIdx = getHeaderIndex(headers, "Date");
  const patientIdIdx = getHeaderIndex(headers, "Patient_ID", "patientId");
  const patientNameIdx = getHeaderIndex(headers, "Patient_Name", "patientName");
  const departmentIdx = getHeaderIndex(headers, "Department");
  const amountIdx = getHeaderIndex(headers, "Amount");
  const discountIdx = getHeaderIndex(headers, "Discount");
  const dueIdx = getHeaderIndex(headers, "Due");
  const methodIdx = getHeaderIndex(headers, "Payment_Method", "paymentMethod");
  const receivedByIdx = getHeaderIndex(headers, "Received_By", "receivedBy");
  const remarksIdx = getHeaderIndex(headers, "Remarks");

  return rows.slice(1).flatMap((row) => {
    const receiptNo = valueAt(row, receiptNoIdx);
    if (!receiptNo) return [];
    const rawMethod = valueAt(row, methodIdx) || "Cash";
    const method = (["Cash", "bKash", "Bank", "Nagad", "Card"] as const).find(
      (item) => item.toLowerCase() === rawMethod.toLowerCase()
    );
    return [
      {
        receiptNo,
        date: valueAt(row, dateIdx),
        patientId: valueAt(row, patientIdIdx),
        patientName: valueAt(row, patientNameIdx),
        department: parseDepartment(valueAt(row, departmentIdx), fallback),
        amount: money(valueAt(row, amountIdx)),
        discount: money(valueAt(row, discountIdx)),
        due: money(valueAt(row, dueIdx)),
        paymentMethod: method || "Cash",
        receivedBy: valueAt(row, receivedByIdx),
        ...(valueAt(row, remarksIdx)
          ? { remarks: valueAt(row, remarksIdx) }
          : {}),
      },
    ];
  });
}

function parseExpenses(rows: string[][], fallback: Department): Expense[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = getHeaderIndex(headers, "Expense_ID", "expenseId");
  const dateIdx = getHeaderIndex(headers, "Date");
  const categoryIdx = getHeaderIndex(headers, "Category");
  const noteIdx = getHeaderIndex(headers, "Note", "Description");
  const amountIdx = getHeaderIndex(headers, "Amount");
  const paidFromIdx = getHeaderIndex(headers, "Paid_From", "Payment_Method");
  const paidByIdx = getHeaderIndex(headers, "Paid_By", "Added_By");
  const departmentIdx = getHeaderIndex(headers, "Department");
  const typeIdx = getHeaderIndex(headers, "Type");
  const statusIdx = getHeaderIndex(headers, "Status");
  const paidAtIdx = getHeaderIndex(headers, "Paid_At");

  return rows.slice(1).flatMap((row) => {
    const expenseId = valueAt(row, idIdx);
    if (!expenseId) return [];
    const expenseType = valueAt(row, typeIdx) || "Clinic Expense";
    const paidFrom = valueAt(row, paidFromIdx);
    return [
      {
        expenseId,
        date: valueAt(row, dateIdx),
        category: valueAt(row, categoryIdx),
        description: valueAt(row, noteIdx),
        amount: money(valueAt(row, amountIdx)),
        paymentMethod: paidFrom,
        paidBy: valueAt(row, paidByIdx),
        department: parseDepartment(valueAt(row, departmentIdx), fallback),
        expenseType,
        paidFrom,
        status: valueAt(row, statusIdx),
        paidAt: valueAt(row, paidAtIdx),
        isHouseholdWithdrawal:
          expenseType.trim().toLowerCase() === "household withdrawal",
      },
    ];
  });
}

function parseStaff(rows: string[][]): StaffMember[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const staffIdIdx = getHeaderIndex(headers, "Staff_ID", "staffId");
  const fullNameIdx = getHeaderIndex(headers, "Full_Name", "fullName");
  const phoneIdx = getHeaderIndex(headers, "Phone");
  const roleIdx = getHeaderIndex(headers, "Role");
  const departmentIdx = getHeaderIndex(
    headers,
    "Primary_Department",
    "Department"
  );
  const salaryIdx = getHeaderIndex(headers, "Salary");
  const statusIdx = getHeaderIndex(headers, "Status");

  return rows.slice(1).flatMap((row) => {
    const staffId = valueAt(row, staffIdIdx);
    if (!staffId) return [];
    const rawStatus = valueAt(row, statusIdx) || "Active";
    return [
      {
        staffId,
        fullName: valueAt(row, fullNameIdx),
        ...(valueAt(row, phoneIdx) ? { phone: valueAt(row, phoneIdx) } : {}),
        role: valueAt(row, roleIdx),
        department: parseDepartment(valueAt(row, departmentIdx), "Physio"),
        salary: money(valueAt(row, salaryIdx)),
        status:
          rawStatus.toLowerCase() === "inactive" ? "Inactive" : "Active",
      },
    ];
  });
}

function parseSalaryPayments(
  rows: string[][],
  fallback: Department,
  staffNames: Map<string, string>
): SalaryPayment[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = getHeaderIndex(headers, "Payment_ID", "id");
  const dateIdx = getHeaderIndex(headers, "Date");
  const staffIdIdx = getHeaderIndex(headers, "Staff_ID", "staffId");
  const departmentIdx = getHeaderIndex(headers, "Department");
  const amountIdx = getHeaderIndex(headers, "Amount");
  const paidFromIdx = getHeaderIndex(headers, "Paid_From");
  const statusIdx = getHeaderIndex(headers, "Status");
  const paidAtIdx = getHeaderIndex(headers, "Paid_At");

  return rows.slice(1).flatMap((row) => {
    const id = valueAt(row, idIdx);
    if (!id) return [];
    const staffId = valueAt(row, staffIdIdx);
    return [
      {
        id,
        date: valueAt(row, dateIdx),
        staffId,
        staffName: staffNames.get(staffId) || "",
        department: parseDepartment(valueAt(row, departmentIdx), fallback),
        amount: money(valueAt(row, amountIdx)),
        type: "Advance" as const,
        paidFrom: valueAt(row, paidFromIdx),
        status: valueAt(row, statusIdx),
        paidAt: valueAt(row, paidAtIdx),
      },
    ];
  });
}

function parseCashMovements(
  rows: string[][],
  fallback: Department
): CashMovement[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = getHeaderIndex(headers, "Movement_ID", "id");
  const dateIdx = getHeaderIndex(headers, "Date");
  const fromIdx = getHeaderIndex(headers, "From_Custodian");
  const toIdx = getHeaderIndex(headers, "To_Custodian");
  const amountIdx = getHeaderIndex(headers, "Amount");
  const receivedIdx = getHeaderIndex(headers, "Received_Amount");
  const statusIdx = getHeaderIndex(headers, "Status");
  const departmentIdx = getHeaderIndex(headers, "Department");
  const noteIdx = getHeaderIndex(headers, "Note", "Remarks");

  return rows.slice(1).flatMap((row) => {
    const id = valueAt(row, idIdx);
    if (!id) return [];
    const receivedText = valueAt(row, receivedIdx);
    return [
      {
        id,
        date: valueAt(row, dateIdx),
        fromCustodian: valueAt(row, fromIdx),
        toCustodian: valueAt(row, toIdx),
        amount: money(valueAt(row, amountIdx)),
        ...(receivedText ? { receivedAmount: money(receivedText) } : {}),
        status: valueAt(row, statusIdx),
        department: parseDepartment(valueAt(row, departmentIdx), fallback),
        ...(valueAt(row, noteIdx) ? { remarks: valueAt(row, noteIdx) } : {}),
      },
    ];
  });
}

async function loadPrivateSnapshot(): Promise<LiveSnapshot> {
  const [physio, dental] = await Promise.all([
    fetchSheetRanges("physio", [...LIVE_RANGES]),
    fetchSheetRanges("dental", [...LIVE_RANGES]),
  ]);

  const staff = parseStaff(physio["08_Staff"] || []);
  const staffNames = new Map(staff.map((item) => [item.staffId, item.fullName]));

  const physioPayments = parsePayments(physio["06_Payments"] || [], "Physio").filter(
    (row) => row.department !== "Dental"
  );
  const dentalPayments = parsePayments(dental["06_Payments"] || [], "Dental").filter(
    (row) => row.department === "Dental"
  );
  const physioExpenses = parseExpenses(physio["07_Expenses"] || [], "Physio").filter(
    (row) => row.department !== "Dental"
  );
  const dentalExpenses = parseExpenses(dental["07_Expenses"] || [], "Dental").filter(
    (row) => row.department === "Dental"
  );
  const physioSalary = parseSalaryPayments(
    physio["13_Salary"] || [],
    "Physio",
    staffNames
  ).filter((row) => row.department !== "Dental");
  const dentalSalary = parseSalaryPayments(
    dental["13_Salary"] || [],
    "Dental",
    staffNames
  ).filter((row) => row.department === "Dental");
  const physioCash = parseCashMovements(
    physio["21_Cash_Movement"] || [],
    "Physio"
  ).filter((row) => row.department !== "Dental");
  const dentalCash = parseCashMovements(
    dental["21_Cash_Movement"] || [],
    "Dental"
  ).filter((row) => row.department === "Dental");

  return {
    payments: [...physioPayments, ...dentalPayments],
    expenses: [...physioExpenses, ...dentalExpenses],
    staff,
    salaryPayments: [...physioSalary, ...dentalSalary],
    cashMovements: [...physioCash, ...dentalCash],
  };
}

async function getPrivateSnapshot(): Promise<LiveSnapshot> {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.createdAt < SNAPSHOT_TTL_MS) {
    return snapshotCache.promise;
  }
  const promise = loadPrivateSnapshot();
  snapshotCache = { createdAt: now, promise };
  try {
    return await promise;
  } catch (error) {
    snapshotCache = undefined;
    throw error;
  }
}

async function fetchAndParseCSV(url: string): Promise<string[][]> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  return lines.map((line) => {
    const row: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
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

async function fromPrivateOrSeed<K extends keyof LiveSnapshot>(
  key: K,
  seed: LiveSnapshot[K]
): Promise<LiveSnapshot[K]> {
  if (!hasPrivateSheetsCredentials()) return seed;
  try {
    return (await getPrivateSnapshot())[key];
  } catch (error) {
    console.error(`Private Google Sheets read failed (${key}):`, error);
    if (process.env.NODE_ENV === "production") {
      throw new Error(`LIVE_DATA_UNAVAILABLE:${key}`);
    }
    return seed;
  }
}

export async function getPayments(): Promise<Payment[]> {
  if (hasPrivateSheetsCredentials()) {
    return fromPrivateOrSeed("payments", paymentsSeed as Payment[]);
  }
  if (!process.env.SHEET_PAYMENTS_CSV) return paymentsSeed as Payment[];
  try {
    return parsePayments(
      await fetchAndParseCSV(process.env.SHEET_PAYMENTS_CSV),
      "Physio"
    );
  } catch (error) {
    console.error("Error fetching payments:", error);
    return paymentsSeed as Payment[];
  }
}

export async function getExpenses(): Promise<Expense[]> {
  if (hasPrivateSheetsCredentials()) {
    return fromPrivateOrSeed("expenses", expensesSeed as Expense[]);
  }
  if (!process.env.SHEET_EXPENSES_CSV) return expensesSeed as Expense[];
  try {
    return parseExpenses(
      await fetchAndParseCSV(process.env.SHEET_EXPENSES_CSV),
      "Physio"
    );
  } catch (error) {
    console.error("Error fetching expenses:", error);
    return expensesSeed as Expense[];
  }
}

export async function getStaff(): Promise<StaffMember[]> {
  if (hasPrivateSheetsCredentials()) {
    return fromPrivateOrSeed("staff", staffSeed as StaffMember[]);
  }
  if (!process.env.SHEET_STAFF_CSV) return staffSeed as StaffMember[];
  try {
    return parseStaff(await fetchAndParseCSV(process.env.SHEET_STAFF_CSV));
  } catch (error) {
    console.error("Error fetching staff:", error);
    return staffSeed as StaffMember[];
  }
}

export async function getSalaryPayments(): Promise<SalaryPayment[]> {
  if (hasPrivateSheetsCredentials()) {
    return fromPrivateOrSeed(
      "salaryPayments",
      salaryPaymentsSeed as SalaryPayment[]
    );
  }
  if (!process.env.SHEET_SALARY_CSV)
    return salaryPaymentsSeed as SalaryPayment[];
  try {
    return parseSalaryPayments(
      await fetchAndParseCSV(process.env.SHEET_SALARY_CSV),
      "Physio",
      new Map()
    );
  } catch (error) {
    console.error("Error fetching salary payments:", error);
    return salaryPaymentsSeed as SalaryPayment[];
  }
}

export async function getCashMovements(): Promise<CashMovement[]> {
  if (hasPrivateSheetsCredentials()) {
    return fromPrivateOrSeed(
      "cashMovements",
      cashMovementsSeed as unknown as CashMovement[]
    );
  }
  if (!process.env.SHEET_CASH_CSV)
    return cashMovementsSeed as unknown as CashMovement[];
  try {
    return parseCashMovements(
      await fetchAndParseCSV(process.env.SHEET_CASH_CSV),
      "Physio"
    );
  } catch (error) {
    console.error("Error fetching cash movements:", error);
    return cashMovementsSeed as unknown as CashMovement[];
  }
}
