import "server-only";

import {
  batchUpdateSpreadsheet,
  getSheetProperties,
  type SpreadsheetBatchRequest,
  type Workbook,
} from "@/lib/data/googleSheets";

export type SheetCellValue = string | number | boolean;

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
