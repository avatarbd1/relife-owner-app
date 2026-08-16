import "server-only";
import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  hasPrivateSheetsCredentials,
  updateSheetValues,
  type Workbook,
} from "@/lib/data/googleSheets";
import {
  decideExpense as decideExpenseInDomain,
  listPendingExpenses,
  type PendingExpense,
} from "@/lib/domain/finance/expenses";

export type PendingExpenseControl = PendingExpense;

export interface PendingCashControl {
  workbook: Workbook;
  id: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  movedBy: string;
  note: string;
  department: string;
}

export interface OwnerControlSnapshot {
  privateSheets: boolean;
  writeEnabled: boolean;
  pendingExpenses: PendingExpenseControl[];
  pendingCashMovements: PendingCashControl[];
}

const PENDING_CASH_STATUSES = new Set([
  "pending",
  "pending approval",
  "requested",
  "awaiting confirmation",
  "awaiting acceptance",
]);

function normalize(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function money(value: string | undefined): number {
  const parsed = Number.parseFloat(
    String(value || "0").replace(/৳|,/g, "").trim()
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((value) => normalize(value));
  for (const name of names) {
    const index = normalized.indexOf(normalize(name));
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function nowDhaka(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function actorName(): string {
  return process.env.OWNER_DISPLAY_NAME || "Owner";
}

function workbookClinic(workbook: Workbook): string {
  return workbook === "dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}

function workbookDepartment(workbook: Workbook): string {
  return workbook === "dental" ? "Dental" : "Physio";
}

function ensureWriteConfiguration(): void {
  if (!hasPrivateSheetsCredentials()) {
    throw new Error("CONTROL_CONFIG_PRIVATE_SHEETS");
  }
  if (process.env.NODE_ENV === "production") {
    if (!process.env.OWNER_PIN) throw new Error("CONTROL_CONFIG_OWNER_PIN");
    if (!process.env.SESSION_SECRET) throw new Error("CONTROL_CONFIG_SESSION_SECRET");
  }
}

async function appendCashAudit(
  workbook: Workbook,
  action: string,
  entityId: string,
  beforeValue: string,
  afterValue: string,
  department: string
): Promise<void> {
  const timestamp = nowDhaka();
  const provenance = new Date().toISOString();
  try {
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [
      [
        `AUD-${randomUUID()}`,
        timestamp,
        actorName(),
        action,
        "CashMovement",
        entityId,
        "",
        beforeValue,
        afterValue,
        "Owner App controlled action",
        "RELIFE",
        workbookClinic(workbook),
        "AMTALI-01",
        `${workbookClinic(workbook)}:${entityId}`,
        "",
        actorName(),
        "owner_pwa",
        "owner_action",
        false,
        true,
        "relife-uda-v1",
        provenance,
        department || workbookDepartment(workbook),
      ],
    ]);
  } catch (error) {
    console.error("Owner cash control audit append failed:", error);
  }
}

function parsePendingCash(
  workbook: Workbook,
  rows: string[][]
): PendingCashControl[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Movement_ID");
  const dateIdx = headerIndex(headers, "Date");
  const fromIdx = headerIndex(headers, "From_Custodian");
  const toIdx = headerIndex(headers, "To_Custodian");
  const amountIdx = headerIndex(headers, "Requested_Amount", "Amount");
  const movedByIdx = headerIndex(headers, "Moved_By");
  const noteIdx = headerIndex(headers, "Note");
  const departmentIdx = headerIndex(headers, "Department");
  const statusIdx = headerIndex(headers, "Status");

  return rows.slice(1).flatMap((row) => {
    const id = at(row, idIdx);
    if (!id || !PENDING_CASH_STATUSES.has(normalize(at(row, statusIdx)))) return [];
    return [
      {
        workbook,
        id,
        date: at(row, dateIdx),
        from: at(row, fromIdx),
        to: at(row, toIdx),
        amount: money(at(row, amountIdx)),
        movedBy: at(row, movedByIdx),
        note: at(row, noteIdx),
        department: at(row, departmentIdx) || workbookDepartment(workbook),
      },
    ];
  });
}

export async function getOwnerControlSnapshot(): Promise<OwnerControlSnapshot> {
  const privateSheets = hasPrivateSheetsCredentials();
  const writeEnabled =
    privateSheets &&
    (process.env.NODE_ENV !== "production" ||
      Boolean(process.env.OWNER_PIN && process.env.SESSION_SECRET));

  if (!privateSheets) {
    return {
      privateSheets,
      writeEnabled: false,
      pendingExpenses: [],
      pendingCashMovements: [],
    };
  }

  try {
    const [pendingExpenses, physio, dental] = await Promise.all([
      listPendingExpenses(),
      fetchSheetRanges("physio", ["21_Cash_Movement"]),
      fetchSheetRanges("dental", ["21_Cash_Movement"]),
    ]);
    return {
      privateSheets,
      writeEnabled,
      pendingExpenses,
      pendingCashMovements: [
        ...parsePendingCash("physio", physio["21_Cash_Movement"] || []),
        ...parsePendingCash("dental", dental["21_Cash_Movement"] || []),
      ],
    };
  } catch (error) {
    console.error("Owner control snapshot failed:", error);
    if (process.env.NODE_ENV === "production") {
      throw new Error("LIVE_DATA_UNAVAILABLE:owner_controls");
    }
    return {
      privateSheets,
      writeEnabled: false,
      pendingExpenses: [],
      pendingCashMovements: [],
    };
  }
}

/** @deprecated Use lib/domain/finance/expenses directly. */
export async function decideExpense(
  workbook: Workbook,
  id: string,
  decision: "approve" | "reject"
): Promise<void> {
  ensureWriteConfiguration();
  await decideExpenseInDomain({
    workbook,
    expenseId: id,
    decision,
    actorId: actorName(),
    reason: decision === "reject" ? "Legacy rejection" : undefined,
  });
}

export async function decideCashMovement(
  workbook: Workbook,
  id: string,
  decision: "accept" | "reject",
  receivedAmount?: number
): Promise<void> {
  ensureWriteConfiguration();
  const snapshot = await fetchSheetRanges(workbook, ["21_Cash_Movement"]);
  const rows = snapshot["21_Cash_Movement"] || [];
  if (rows.length < 2) throw new Error("CONTROL_NOT_FOUND");

  const headers = rows[0];
  const idIdx = headerIndex(headers, "Movement_ID");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  const amountIdx = headerIndex(headers, "Amount");
  const requestedAmountIdx = headerIndex(headers, "Requested_Amount");

  if ([idIdx, statusIdx].some((index) => index < 0)) {
    throw new Error("CONTROL_SCHEMA_MISMATCH");
  }

  const dataIndex = rows.slice(1).findIndex((row) => at(row, idIdx) === id);
  if (dataIndex < 0) throw new Error("CONTROL_NOT_FOUND");
  const row = rows[dataIndex + 1];
  const currentStatus = at(row, statusIdx);
  if (!PENDING_CASH_STATUSES.has(normalize(currentStatus))) {
    throw new Error("CONTROL_ALREADY_DECIDED");
  }

  const rowNumber = dataIndex + 2;
  const actor = actorName();
  const timestamp = nowDhaka();
  const values = Array.from({ length: 15 }, (_, index) => at(row, 20 + index));
  const requested =
    money(at(row, requestedAmountIdx)) || money(at(row, amountIdx));

  if (decision === "accept") {
    const received =
      typeof receivedAmount === "number" && Number.isFinite(receivedAmount)
        ? Math.max(0, receivedAmount)
        : requested;
    values[0] = "Accepted";
    values[1] = actor;
    values[2] = timestamp;
    values[8] = String(received);
    values[9] = String(received - requested);
    values[10] = actor;
    values[12] = timestamp;
    values[13] = timestamp;
    values[14] = timestamp;
  } else {
    values[0] = "Rejected";
    values[1] = actor;
    values[2] = timestamp;
    values[14] = timestamp;
  }

  await updateSheetValues(
    workbook,
    `'21_Cash_Movement'!U${rowNumber}:AI${rowNumber}`,
    [values]
  );
  await appendCashAudit(
    workbook,
    decision === "accept" ? "CASH_MOVEMENT_ACCEPTED" : "CASH_MOVEMENT_REJECTED",
    id,
    currentStatus,
    decision === "accept" ? "Accepted" : "Rejected",
    at(row, departmentIdx)
  );
}
