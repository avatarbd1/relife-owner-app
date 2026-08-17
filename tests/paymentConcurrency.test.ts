import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("payment production path serializes the full same-patient mutation", () => {
  const source = read("lib/domain/finance/production.ts");
  assert.match(source, /withMutationLock/);
  assert.match(source, /finance:payment:\$\{department\}:\$\{patientId\}/);

  const lockStart = source.indexOf("return withMutationLock(`finance:payment:");
  const sheetsWrite = source.indexOf("createSheetsPayment", lockStart);
  const financeSync = source.indexOf("await syncFinance", sheetsWrite);
  const returnResult = source.indexOf("return result;", financeSync);
  assert.ok(lockStart >= 0 && sheetsWrite > lockStart && financeSync > sheetsWrite && returnResult > financeSync);
});

test("same-patient lock key is patient scoped", () => {
  const source = read("lib/domain/finance/production.ts");
  assert.match(source, /const patientId = normalize\(input\.patientId\)\.toUpperCase\(\)/);
  assert.match(source, /const department = departmentFromPatientId\(patientId\)/);
  assert.match(source, /withMutationLock\(`finance:payment:\$\{department\}:\$\{patientId\}`/);
});

test("Sheets payment keeps Paid/Due/status and payment append in one spreadsheet batch", () => {
  const source = read("lib/domain/finance/payments.ts");
  const batchCall = source.indexOf("await batchUpdateSpreadsheet(workbook, requests)");
  assert.ok(batchCall > 0);
  assert.ok(source.indexOf("updateCellRequest(patientSheetId, rowNumber, paidIdx + 1, newPaid)") < batchCall);
  assert.ok(source.indexOf("updateCellRequest(patientSheetId, rowNumber, dueIdx + 1, newDue)") < batchCall);
  assert.ok(source.indexOf("updateCellRequest(patientSheetId, rowNumber, paymentStatusIdx + 1, paymentStatus)") < batchCall);
  assert.ok(source.indexOf("appendRowRequest(paymentSheetId, paymentRow)") < batchCall);
});
