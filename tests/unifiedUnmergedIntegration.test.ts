import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("payment corrections remain append-only", () => {
  const corrections = source("lib/webos/ownCorrections.ts");
  assert.match(corrections, /REVERSAL_OF:/);
  assert.match(corrections, /Amount: -amount/);
  assert.match(corrections, /Discount: -discount/);
  assert.match(corrections, /PAYMENT_ALREADY_REVERSED/);
  assert.doesNotMatch(corrections, /deleteDimension/);
});

test("A11 Chamber UX stays on the existing chamber API", () => {
  const board = source("components/LiveChamberBoard.tsx");
  assert.match(board, /ChamberPatientFlowTimeline/);
  assert.match(board, /ChamberStepWorkflow/);
  assert.match(board, /fetch\("\/api\/chamber"/);
  assert.doesNotMatch(board, /\/api\/treatment/);
});

test("payments remember the last patient and use global toast feedback", () => {
  const payments = source("components/PaymentsWorkspaceClient.tsx");
  const layout = source("app/layout.tsx");
  assert.match(payments, /relife_payment_last_patient_id/);
  assert.match(payments, /useToastContext/);
  assert.match(layout, /ToastProvider/);
});

test("keyboard shortcuts use current canonical routes", () => {
  const shortcuts = source("lib/keyboard-shortcuts.ts");
  assert.match(shortcuts, /router\.push\("\/payments"\)/);
  assert.match(shortcuts, /router\.push\("\/appointments"\)/);
  assert.match(shortcuts, /router\.push\("\/patients"\)/);
  assert.match(shortcuts, /router\.push\("\/home"\)/);
  assert.doesNotMatch(shortcuts, /router\.push\("\/treatment"\)/);
});

test("bulk expense approval reuses the PIN-protected canonical control API", () => {
  const bulk = source("components/BulkExpenseApproval.tsx");
  const route = source("app/api/control/expense/route.ts");
  assert.match(bulk, /fetch\("\/api\/control\/expense"/);
  assert.match(bulk, /for \(const item of selectedItems\)/);
  assert.doesNotMatch(bulk, /decideExpense/);
  assert.doesNotMatch(bulk, /use server/);
  assert.match(route, /checkOwnerPin/);
  assert.match(route, /decideExpense/);
});

test("old mock salary and treatment writers were not imported", () => {
  const salaryPage = source("app/(dashboard)/salary/page.tsx");
  const clinical = source("components/ClinicalWorkspaceClient.tsx");
  assert.doesNotMatch(salaryPage, /SAL-\$\{Date\.now\(\)\}/);
  assert.doesNotMatch(clinical, /TRT-\$\{Date\.now\(\)\}/);
});
