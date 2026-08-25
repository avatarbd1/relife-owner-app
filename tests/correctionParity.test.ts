import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("own correction list reads both Physio and Dental payments", () => {
  const corrections = source("lib/webos/ownCorrections.ts");
  assert.match(corrections, /\["Physio", "Dental"\] as ClinicDepartment\[\]/);
  assert.match(corrections, /workbookFor\(department\)/);
  assert.match(corrections, /payment\.correct_own_today/);
});

test("own same-day correction reverses patient Paid and Due with an append-only ledger entry", () => {
  const corrections = source("lib/webos/ownCorrections.ts");
  assert.match(corrections, /const newPaid = Math\.max\(0, currentPaid - amount\)/);
  assert.match(corrections, /const restoredDueRaw = currentDue \+ amount \+ discount/);
  assert.match(corrections, /updateCellRequest\(patientSheetId, patientRowNumber, paidIdx \+ 1, newPaid\)/);
  assert.match(corrections, /updateCellRequest\(patientSheetId, patientRowNumber, dueIdx \+ 1, newDue\)/);
  assert.match(corrections, /Amount: -amount/);
  assert.match(corrections, /Discount: -discount/);
  assert.match(corrections, /REVERSAL_OF:/);
  assert.match(corrections, /payment\.reverse_own_today_append_only/);
  assert.doesNotMatch(corrections, /deleteDimension/);
});

test("already-reversed receipts are hidden and cannot be reversed twice", () => {
  const corrections = source("lib/webos/ownCorrections.ts");
  assert.match(corrections, /reversedReceipts/);
  assert.match(corrections, /reversalOf\(remarks\)/);
  assert.match(corrections, /PAYMENT_ALREADY_REVERSED/);
});

test("correction fails closed for another staff member, stale due, or non-latest payment", () => {
  const corrections = source("lib/webos/ownCorrections.ts");
  assert.match(corrections, /OWN_ENTRY_REQUIRED/);
  assert.match(corrections, /STALE_PAYMENT_STATE/);
  assert.match(corrections, /PAYMENT_NOT_LATEST_FOR_PATIENT/);
  assert.match(corrections, /TODAY_ONLY_CORRECTION/);
});

test("correction provenance uses the authenticated tenant identifiers", () => {
  const corrections = source("lib/webos/ownCorrections.ts");
  assert.match(corrections, /department === "Dental" \? "dental" : "physio"/);
  assert.match(corrections, /organizationId: string/);
  assert.match(corrections, /clinicId: string/);
  assert.match(corrections, /Organization_ID: organizationId/);
  assert.match(corrections, /Clinic_ID: clinicId/);
  assert.match(corrections, /Record_ID: `\$\{clinicId\}:/);
  assert.match(corrections, /Department: department/);
  assert.doesNotMatch(corrections, /department === "Dental" \? "RELIFE-DENTAL" : "RELIFE-PHYSIO"/);
});

test("corrections API requires department and exact receipt confirmation", () => {
  const route = source("app/api/corrections/route.ts");
  const client = source("components/OwnCorrectionsClient.tsx");
  assert.match(route, /deleteOwnLatestTodayPayment/);
  assert.match(route, /department: body\.department/);
  assert.match(route, /CONFIRMATION_MISMATCH/);
  assert.match(client, /department: entry\.department/);
  assert.match(client, /confirmReceiptNo: entry\.receiptNo/);
});
