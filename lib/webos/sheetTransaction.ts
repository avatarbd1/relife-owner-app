import "server-only";

import {
  batchUpdateSpreadsheet,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";

export type SheetCellValue = string | number | boolean;

export interface SheetCellUpdate {
  sheet: string;
  rowNumber: number;
  columnNumber: number;
  value: SheetCellValue;
}

export interface SheetRowAppend {
  sheet: string;
  row: SheetCellValue[];
}

function cellValue(value: SheetCellValue): Record<string, unknown> {
  if (typeof value === "boolean") {
    return { userEnteredValue: { boolValue: value } };
  }
  if (typeof value === "number") {
    return { userEnteredValue: { numberValue: value } };
  }
  return { userEnteredValue: { stringValue: String(value) } };
}

async function sheetIdMap(workbook: Workbook): Promise<Map<string, number>> {
  const properties = await getSheetProperties(workbook);
  return new Map(properties.map((item) => [item.title, item.sheetId]));
}

function requireSheetId(map: Map<string, number>, title: string): number {
  const id = map.get(title);
  if (typeof id !== "number") throw new Error("SCHEMA_MISMATCH");
  return id;
}

function appendRowRequest(sheetId: number, row: SheetCellValue[]): SpreadsheetBatchRequest {
  return {
    appendCells: {
      sheetId,
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}

function replaceRowRequest(
  sheetId: number,
  rowNumber: number,
  row: SheetCellValue[]
): SpreadsheetBatchRequest {
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: 0,
        endColumnIndex: row.length,
      },
      rows: [{ values: row.map(cellValue) }],
      fields: "userEnteredValue",
    },
  };
}

function updateCellRequest(
  sheetId: number,
  rowNumber: number,
  columnNumber: number,
  value: SheetCellValue
): SpreadsheetBatchRequest {
  if (rowNumber < 1 || columnNumber < 1) throw new Error("SCHEMA_MISMATCH");
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

export async function appendEntityWithAudit(
  workbook: Workbook,
  entitySheet: string,
  entityRow: SheetCellValue[],
  auditRow: SheetCellValue[]
): Promise<void> {
  const ids = await sheetIdMap(workbook);
  await batchUpdateSpreadsheet(workbook, [
    appendRowRequest(requireSheetId(ids, entitySheet), entityRow),
    appendRowRequest(requireSheetId(ids, "20_Data_Audit"), auditRow),
  ]);
}

export async function appendRowsWithAudit(
  workbook: Workbook,
  appends: SheetRowAppend[],
  auditRow: SheetCellValue[]
): Promise<void> {
  if (appends.length === 0) throw new Error("SCHEMA_MISMATCH");
  const ids = await sheetIdMap(workbook);
  const requests: SpreadsheetBatchRequest[] = appends.map((item) =>
    appendRowRequest(requireSheetId(ids, item.sheet), item.row)
  );
  requests.push(appendRowRequest(requireSheetId(ids, "20_Data_Audit"), auditRow));
  await batchUpdateSpreadsheet(workbook, requests);
}

export async function appendEntityWithCellUpdatesAndAudit(
  workbook: Workbook,
  entitySheet: string,
  entityRow: SheetCellValue[],
  updates: SheetCellUpdate[],
  auditRow: SheetCellValue[]
): Promise<void> {
  const ids = await sheetIdMap(workbook);
  const requests: SpreadsheetBatchRequest[] = [
    appendRowRequest(requireSheetId(ids, entitySheet), entityRow),
  ];
  for (const update of updates) {
    requests.push(
      updateCellRequest(
        requireSheetId(ids, update.sheet),
        update.rowNumber,
        update.columnNumber,
        update.value
      )
    );
  }
  requests.push(appendRowRequest(requireSheetId(ids, "20_Data_Audit"), auditRow));
  await batchUpdateSpreadsheet(workbook, requests);
}

export async function replaceEntityRowWithAudit(
  workbook: Workbook,
  entitySheet: string,
  rowNumber: number,
  entityRow: SheetCellValue[],
  auditRow: SheetCellValue[]
): Promise<void> {
  const ids = await sheetIdMap(workbook);
  await batchUpdateSpreadsheet(workbook, [
    replaceRowRequest(requireSheetId(ids, entitySheet), rowNumber, entityRow),
    appendRowRequest(requireSheetId(ids, "20_Data_Audit"), auditRow),
  ]);
}
