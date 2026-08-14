import "server-only";

import { randomUUID } from "node:crypto";
import {
  batchUpdateSpreadsheet,
  fetchSheetRanges,
  getSheetProperties,
  type SpreadsheetBatchRequest,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

type SheetValue = string | number | boolean;

export interface InventoryItem {
  itemId: string;
  itemName: string;
  category: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
  supplier: string;
  lastUpdated: string;
  lowStock: boolean;
}

export interface InventoryLogRow {
  timestamp: string;
  itemId: string;
  itemName: string;
  change: number;
  reason: string;
  staff: string;
  newBalance: number;
}

export interface InventorySnapshot {
  items: InventoryItem[];
  recentLog: InventoryLogRow[];
  canWrite: boolean;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function money(value: unknown): number {
  const parsed = Number(normalize(value).replace(/[৳,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function headerIndex(headers: string[], name: string): number {
  const needle = name.toLowerCase();
  return headers.findIndex((header) => normalized(header) === needle);
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function rowForHeaders(headers: string[], values: Record<string, SheetValue>): SheetValue[] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return headers.map((header) => map.get(normalized(header)) ?? "");
}

function cellValue(value: SheetValue) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value } };
}

function updateCellRequest(
  sheetId: number,
  rowNumber: number,
  columnNumber: number,
  value: SheetValue
): SpreadsheetBatchRequest {
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: columnNumber - 1,
        endColumnIndex: columnNumber,
      },
      rows: [{ values: [cellValue(value)] }],
      fields: "userEnteredValue",
    },
  };
}

function appendRowRequest(sheetId: number, row: SheetValue[]): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    timestamp: `${date} ${values.hour}:${values.minute}`,
    provenance: ref.toISOString(),
  };
}

async function sheetIdMap(): Promise<Map<string, number>> {
  const properties = await getSheetProperties("physio");
  return new Map(properties.map((item) => [item.title, item.sheetId]));
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("INVENTORY_SCHEMA_MISMATCH");
  return id;
}

function parseItems(rows: string[][]): InventoryItem[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  return rows.slice(1).flatMap((row) => {
    const department = at(row, idx("Department"));
    const itemId = at(row, idx("Item_ID"));
    if (department !== "Physio" || !itemId) return [];
    const currentStock = money(at(row, idx("Current_Stock")));
    const minimumStock = money(at(row, idx("Minimum_Stock")) || at(row, idx("Minimum")));
    return [{
      itemId,
      itemName: at(row, idx("Item_Name")),
      category: at(row, idx("Category")),
      currentStock,
      minimumStock,
      unit: at(row, idx("Unit")),
      supplier: at(row, idx("Supplier")),
      lastUpdated: at(row, idx("Last_Updated")),
      lowStock: currentStock <= minimumStock,
    }];
  });
}

function parseLog(rows: string[][]): InventoryLogRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = (name: string) => headerIndex(headers, name);
  return rows.slice(1).flatMap((row) => {
    if (at(row, idx("Department")) !== "Physio") return [];
    const itemName = at(row, idx("Item_Name"));
    if (!itemName) return [];
    return [{
      timestamp: at(row, idx("Timestamp")),
      itemId: at(row, idx("Item_ID")),
      itemName,
      change: money(at(row, idx("Change"))),
      reason: at(row, idx("Reason")),
      staff: at(row, idx("Staff")),
      newBalance: money(at(row, idx("New_Balance"))),
    }];
  }).reverse().slice(0, 40);
}

export async function getPhysioInventorySnapshot(
  context: AccessContext
): Promise<InventorySnapshot> {
  assertCanPerform(context, "inventory.read", "Physio");
  const snapshot = await fetchSheetRanges("physio", ["09_Inventory", "17_Inventory_Log"]);
  return {
    items: parseItems(snapshot["09_Inventory"] || []),
    recentLog: parseLog(snapshot["17_Inventory_Log"] || []),
    canWrite: (() => {
      try {
        assertCanPerform(context, "inventory.write", "Physio");
        return true;
      } catch {
        return false;
      }
    })(),
  };
}

async function adjustRaw(
  staffId: string,
  itemName: string,
  change: number,
  reason: string
): Promise<{ itemName: string; previous: number; newBalance: number }> {
  const requestedName = normalize(itemName);
  const safeReason = normalize(reason).slice(0, 240) || "Manual adjustment";
  if (!requestedName) throw new Error("INVENTORY_ITEM_REQUIRED");
  if (!Number.isFinite(change) || change === 0 || Math.abs(change) > 100000) {
    throw new Error("INVALID_INVENTORY_CHANGE");
  }

  const [snapshot, ids] = await Promise.all([
    fetchSheetRanges("physio", ["09_Inventory", "17_Inventory_Log", "20_Data_Audit"]),
    sheetIdMap(),
  ]);
  const inventoryRows = snapshot["09_Inventory"] || [];
  const logRows = snapshot["17_Inventory_Log"] || [];
  const auditRows = snapshot["20_Data_Audit"] || [];
  if (inventoryRows.length < 1 || logRows.length < 1 || auditRows.length < 1) {
    throw new Error("INVENTORY_SCHEMA_MISMATCH");
  }

  const headers = inventoryRows[0];
  const nameIdx = headerIndex(headers, "Item_Name");
  const deptIdx = headerIndex(headers, "Department");
  const stockIdx = headerIndex(headers, "Current_Stock");
  const itemIdIdx = headerIndex(headers, "Item_ID");
  const updatedIdx = headerIndex(headers, "Last_Updated");
  if ([nameIdx, deptIdx, stockIdx, itemIdIdx].some((index) => index < 0)) {
    throw new Error("INVENTORY_SCHEMA_MISMATCH");
  }

  const dataIndex = inventoryRows.slice(1).findIndex(
    (row) =>
      normalized(at(row, nameIdx)) === normalized(requestedName) &&
      at(row, deptIdx) === "Physio"
  );
  if (dataIndex < 0) throw new Error("INVENTORY_ITEM_NOT_FOUND");
  const sourceRow = inventoryRows[dataIndex + 1];
  const rowNumber = dataIndex + 2;
  const previous = money(at(sourceRow, stockIdx));
  const newBalance = Math.max(0, previous + change);
  const itemId = at(sourceRow, itemIdIdx);
  const canonicalName = at(sourceRow, nameIdx);
  const now = dhakaNow();
  const recordId = `ILW${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

  const logRow = rowForHeaders(logRows[0], {
    Timestamp: now.timestamp,
    Item_ID: itemId,
    Item_Name: canonicalName,
    Change: change,
    Reason: safeReason,
    Staff: staffId,
    New_Balance: newBalance,
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${recordId}`,
    Provider_ID: staffId,
    Source_System: "web_pwa",
    Source_Type: safeReason.startsWith("Auto-") ? "system_derived" : "human_entry",
    AI_Generated: false,
    Human_Verified: !safeReason.startsWith("Auto-"),
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: "Physio",
  });

  const auditId = `AUD-${randomUUID()}`;
  const auditRow = rowForHeaders(auditRows[0], {
    Audit_ID: auditId,
    Timestamp: now.timestamp,
    Actor_ID: staffId,
    Action: safeReason.startsWith("Auto-") ? "inventory.auto_adjust" : "inventory.adjust",
    Entity_Type: "Inventory",
    Entity_ID: itemId,
    Patient_ID: "",
    Before_Value: String(previous),
    After_Value: String(newBalance),
    Reason: `${safeReason}; requested change ${change}`,
    Organization_ID: "RELIFE",
    Clinic_ID: "RELIFE-PHYSIO",
    Branch_ID: "AMTALI-01",
    Record_ID: `RELIFE-PHYSIO:${auditId}`,
    Provider_ID: staffId,
    Source_System: "web_pwa",
    Source_Type: safeReason.startsWith("Auto-") ? "system_derived" : "human_entry",
    AI_Generated: false,
    Human_Verified: !safeReason.startsWith("Auto-"),
    Schema_Version: "relife-uda-v1",
    Provenance_Timestamp: now.provenance,
    Department: "Physio",
  });

  const inventorySheetId = requireSheetId(ids, "09_Inventory");
  const logSheetId = requireSheetId(ids, "17_Inventory_Log");
  const auditSheetId = requireSheetId(ids, "20_Data_Audit");
  const requests: SpreadsheetBatchRequest[] = [
    updateCellRequest(inventorySheetId, rowNumber, stockIdx + 1, newBalance),
  ];
  if (updatedIdx >= 0) {
    requests.push(updateCellRequest(inventorySheetId, rowNumber, updatedIdx + 1, now.timestamp));
  }
  requests.push(appendRowRequest(logSheetId, logRow));
  requests.push(appendRowRequest(auditSheetId, auditRow));
  await batchUpdateSpreadsheet("physio", requests);
  return { itemName: canonicalName, previous, newBalance };
}

export async function adjustPhysioInventory(
  context: AccessContext,
  input: { itemName: string; change: number; reason: string }
) {
  assertCanPerform(context, "inventory.write", "Physio");
  return adjustRaw(context.staffId, input.itemName, Number(input.change), input.reason);
}

export async function consumePhysioInventorySystem(
  itemNames: string[],
  staffId: string,
  reason: "Auto-Registration" | "Auto-Session"
): Promise<void> {
  for (const itemName of itemNames) {
    try {
      await adjustRaw(staffId, itemName, -1, reason);
    } catch (error) {
      // Inventory bookkeeping must never duplicate/block an already-authorized
      // registration or treatment write. The failed deduction stays visible in logs.
      console.error(`Inventory ${reason} failed for ${itemName}`, error);
    }
  }
}
