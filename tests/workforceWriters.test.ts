import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findWorkforceRequest,
  workforceRequestLedger,
} from "../lib/domain/workforce/workforceRequest.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * These are structural/source-pattern tests, not live-Sheets behavioral
 * tests — consistent with this repo's existing convention for server-only
 * Sheets writers with no live credentials available in this sandbox (see
 * tests/clinicalSessionIdempotency.test.ts, tests/dentalBillingForwardPort.test.ts).
 * mock.module() from node:test could give true behavioral coverage of the
 * Sheets I/O layer, but it requires --experimental-test-module-mocks, which
 * would mean changing package.json's "test" script — out of this task's
 * allowed changed-file scope. Documented as a follow-up in REVIEW.md.
 */

test("missing sheet/header readiness fails closed with WORKFORCE_SCHEMA_NOT_PROVISIONED", () => {
  const sheetsIo = source("lib/domain/workforce/sheetsIo.ts");
  assert.match(sheetsIo, /if \(rows\.length < 1\) throw new Error\("WORKFORCE_SCHEMA_NOT_PROVISIONED"\)/);
  assert.match(sheetsIo, /const missingHeader = requiredHeaders\.some/);
  assert.match(sheetsIo, /if \(missingHeader\) throw new Error\("WORKFORCE_SCHEMA_NOT_PROVISIONED"\)/);
  assert.match(sheetsIo, /if \(typeof id !== "number"\) throw new Error\("WORKFORCE_SCHEMA_NOT_PROVISIONED"\)/);
  assert.match(sheetsIo, /WORKFORCE_AUDIT_HEADERS\.some/);
  // Never creates the tab/headers — provisioning is a separately controlled operation.
  assert.doesNotMatch(sheetsIo, /addSheet|createSheet|insertSheet/);
});

test("shift-create retry returns the existing row before any write (one row + one audit event per requestId)", () => {
  const shifts = source("lib/domain/workforce/shifts.ts");
  const duplicateCheckIndex = shifts.indexOf(
    'const existing = records.find((row) => row.requestId === requestId);'
  );
  const overlapCheckIndex = shifts.indexOf("const overlap = shiftOverlaps(");
  const commitIndex = shifts.indexOf("await commitWorkforceBatch([\n      appendRowRequest(shiftSheetId, row)");
  assert.notEqual(duplicateCheckIndex, -1);
  assert.notEqual(overlapCheckIndex, -1);
  assert.notEqual(commitIndex, -1);
  assert.ok(
    duplicateCheckIndex < overlapCheckIndex && overlapCheckIndex < commitIndex,
    "duplicate-by-requestId must be checked before overlap validation and before any Sheets write"
  );
  assert.match(shifts, /requestUse\.action === "shift\.create"/);
  assert.match(shifts, /status: "Draft", duplicate: true/);
});

test("leave-request retry returns the existing row before any write (one row + one audit event per requestId)", () => {
  const leave = source("lib/domain/workforce/leave.ts");
  const duplicateCheckIndex = leave.indexOf(
    "const existing = records.find((row) => row.requestId === requestId);"
  );
  const overlapCheckIndex = leave.indexOf("const overlap = leaveOverlaps(");
  const commitIndex = leave.indexOf("await commitWorkforceBatch([\n      appendRowRequest(leaveSheetId, row)");
  assert.notEqual(duplicateCheckIndex, -1);
  assert.notEqual(overlapCheckIndex, -1);
  assert.notEqual(commitIndex, -1);
  assert.ok(duplicateCheckIndex < overlapCheckIndex && overlapCheckIndex < commitIndex);
  assert.match(leave, /requestUse\.action === "leave\.request"/);
  assert.match(leave, /status: "Pending", duplicate: true/);
});

test("transition request IDs use the audit ledger and never overwrite the immutable create Request_ID", () => {
  const shifts = source("lib/domain/workforce/shifts.ts");
  const leave = source("lib/domain/workforce/leave.ts");
  assert.match(shifts, /findWorkforceRequest\(/);
  assert.match(leave, /findWorkforceRequest\(/);
  assert.doesNotMatch(shifts, /idx\("Request_ID"\).*input\.requestId/);
  assert.doesNotMatch(leave, /idx\("Request_ID"\).*input\.requestId/);
});

test("audit-ledger lookup preserves an old transition retry after a later transition", () => {
  const headers = ["Action", "Entity_Type", "Entity_ID", "Actor_ID", "After_Value"];
  const rows = [
    ["shift.create", "Shift", "SHF1", "OWNER1", JSON.stringify({ requestId: "req_create_01", status: "Draft" })],
    ["shift.publish", "Shift", "SHF1", "OWNER1", JSON.stringify({ requestId: "req_publish_01", status: "Published" })],
    ["shift.cancel", "Shift", "SHF1", "OWNER1", JSON.stringify({ requestId: "req_cancel_01", status: "Cancelled" })],
  ];
  const entry = findWorkforceRequest(workforceRequestLedger(headers, rows), "req_publish_01");
  assert.deepEqual(entry, {
    action: "shift.publish",
    entityType: "Shift",
    entityId: "SHF1",
    actorId: "OWNER1",
    requestId: "req_publish_01",
    status: "Published",
  });
});

test("malformed or duplicate workforce audit request markers fail closed", () => {
  const headers = ["Action", "Entity_Type", "Entity_ID", "Actor_ID", "After_Value"];
  assert.throws(
    () => workforceRequestLedger(headers, [["shift.publish", "Shift", "SHF1", "OWNER1", "not-json"]]),
    /WORKFORCE_DATA_INVALID/
  );
  const duplicate = workforceRequestLedger(headers, [
    ["shift.publish", "Shift", "SHF1", "OWNER1", JSON.stringify({ requestId: "req_duplicate_01", status: "Published" })],
    ["leave.approve", "Leave", "LVE1", "OWNER1", JSON.stringify({ requestId: "req_duplicate_01", status: "Approved" })],
  ]);
  assert.throws(() => findWorkforceRequest(duplicate, "req_duplicate_01"), /WORKFORCE_DATA_INVALID/);
});

test("every mutation writes the domain row/cell updates and the 20_Data_Audit row in exactly one Sheets batch transaction", () => {
  const shifts = source("lib/domain/workforce/shifts.ts");
  const leave = source("lib/domain/workforce/leave.ts");
  const sheetsIo = source("lib/domain/workforce/sheetsIo.ts");
  // commitWorkforceBatch is the sole Sheets-mutation entry point for this
  // domain, and it forwards to the shared batchUpdateSpreadsheet(workbook, requests) — one request array, one API call.
  assert.match(sheetsIo, /export async function commitWorkforceBatch/);
  assert.match(sheetsIo, /await batchUpdateSpreadsheet\(WORKFORCE_WORKBOOK, requests\)/);
  const shiftCommitCalls = shifts.match(/commitWorkforceBatch\(/g) || [];
  const leaveCommitCalls = leave.match(/commitWorkforceBatch\(/g) || [];
  assert.equal(shiftCommitCalls.length, 3, "create + draft update + one shared transition call");
  assert.match(shifts, /async function writeShiftTransition/);
  const writeShiftTransitionCalls = (shifts.match(/await writeShiftTransition\(\{/g) || []).length;
  assert.equal(writeShiftTransitionCalls, 2, "publishShift and cancelShift both funnel through the single writeShiftTransition commit path");

  assert.equal(leaveCommitCalls.length, 2, "requestLeave's direct call + writeLeaveTransition's one shared call");
  assert.match(leave, /async function writeLeaveTransition/);
  const writeLeaveTransitionCalls = (leave.match(/await writeLeaveTransition\(\{/g) || []).length;
  assert.equal(writeLeaveTransitionCalls, 2, "decideLeave and cancelLeave both funnel through the single writeLeaveTransition commit path");
});

test("publishing a shift checks Approved-leave conflict before writing the Published transition", () => {
  const shifts = source("lib/domain/workforce/shifts.ts");
  const transitionCheckIndex = shifts.indexOf('isValidShiftTransition(record.status, "Published")');
  const conflictReadIndex = shifts.indexOf("readApprovedLeaveRangesForStaff(record.staffId)");
  const conflictThrowIndex = shifts.indexOf('throw new Error("SHIFT_LEAVE_CONFLICT")');
  const writeIndex = shifts.indexOf("await writeShiftTransition({", conflictThrowIndex);
  assert.notEqual(transitionCheckIndex, -1);
  assert.notEqual(conflictReadIndex, -1);
  assert.notEqual(conflictThrowIndex, -1);
  assert.notEqual(writeIndex, -1);
  assert.ok(
    transitionCheckIndex < conflictReadIndex &&
      conflictReadIndex < conflictThrowIndex &&
      conflictThrowIndex < writeIndex,
    "order must be: transition validity -> Approved-leave conflict check -> write"
  );
  assert.match(shifts, /import \{ readApprovedLeaveRangesForStaff \} from "\.\/leave"/);
});

test("the Workforce UI separates schema readiness from an ordinary read failure", () => {
  const client = source("components/WorkforceClient.tsx");
  assert.match(client, /shiftsError === "schema"[\s\S]*?not provisioned yet/);
  assert.match(client, /shiftsError === "read"[\s\S]*?Schedule read failed/);
  assert.match(client, /leaveError === "schema"[\s\S]*?not provisioned yet/);
  assert.match(client, /leaveError === "read"[\s\S]*?Leave read failed/);
  assert.match(client, /!shiftsError/);
  assert.match(client, /!leaveError/);
});

test("distributed mutation lock guards every shift and leave mutation, keyed to the mutated row/staff", () => {
  const shifts = source("lib/domain/workforce/shifts.ts");
  const leave = source("lib/domain/workforce/leave.ts");
  assert.match(shifts, /withMutationLock\(`workforce-shift:\$\{staffId\}`/);
  assert.match(shifts, /withMutationLock\(`workforce-shift:\$\{initial\.record\.staffId\}`/);
  assert.match(shifts, /withMutationLock\(`workforce-shift-row:\$\{normalize\(input\.shiftId\)\}`/g);
  assert.match(leave, /withMutationLock\(`workforce-leave:\$\{staffId\}`/);
  assert.match(leave, /withMutationLock\(`workforce-leave-row:\$\{normalize\(input\.leaveId\)\}`/g);
});

test("lost-response retries keep the same client request ID until success", () => {
  const client = source("components/WorkforceClient.tsx");
  assert.match(client, /requestIdsRef = useRef\(new Map/);
  assert.match(client, /function actionRequestId/);
  assert.match(client, /function clearActionRequestId/);
  assert.doesNotMatch(client, /requestId: nextRequestId\(\)/);
});

test("manager staff options are server-filtered by explicit shift.manage department scope", () => {
  const page = source("app/(dashboard)/workforce/page.tsx");
  assert.match(page, /canPerform\(context, "shift\.manage", item\.primaryDepartment\)/);
  assert.match(page, /staffOptionsUnavailable/);
});

test("persisted workforce rows never default malformed department or status values", () => {
  const shifts = source("lib/domain/workforce/shifts.ts");
  const leave = source("lib/domain/workforce/leave.ts");
  assert.doesNotMatch(shifts, /\|\| "Physio"/);
  assert.doesNotMatch(shifts, /\|\| "Draft"/);
  assert.doesNotMatch(leave, /\|\| "Physio"/);
  assert.doesNotMatch(leave, /\|\| "Pending"/);
  assert.match(shifts, /WORKFORCE_DATA_INVALID/);
  assert.match(leave, /WORKFORCE_DATA_INVALID/);
});

test("no attendance, salary, reward, appointment, clinical, inventory, patient, or finance mutation is reachable from the workforce domain", () => {
  const files = [
    "lib/domain/workforce/shifts.ts",
    "lib/domain/workforce/leave.ts",
    "lib/domain/workforce/sheetsIo.ts",
    "lib/domain/workforce/shiftPolicy.ts",
    "lib/domain/workforce/leavePolicy.ts",
    "lib/domain/workforce/workforceScope.ts",
  ].map(source);
  const forbidden = [
    /performAttendanceAction|performNormalAttendanceCheckIn/,
    /paySalary/,
    /recordActorWorkGamification|claimReward/,
    /createAppointment|createCapacityBooking/,
    /recordTreatmentSession|addDentalTreatmentNote/,
    /adjustInventoryStock|consumePhysioInventorySystem/,
    /registerPatient/,
    /createPayment|payExpense|requestCashMovement/,
  ];
  for (const content of files) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern);
    }
  }
});

test("no Python writer or alternate API is referenced by the workforce domain", () => {
  const files = [
    "lib/domain/workforce/shifts.ts",
    "lib/domain/workforce/leave.ts",
    "app/api/workforce/shifts/route.ts",
    "app/api/workforce/shifts/[shiftId]/route.ts",
    "app/api/workforce/leave/route.ts",
  ].map(source);
  for (const content of files) {
    assert.doesNotMatch(content, /python|telegram|bot\.py/i);
  }
});

test("shift routes map every domain error to the correct HTTP status", () => {
  const create = source("app/api/workforce/shifts/route.ts");
  const publish = source("app/api/workforce/shifts/[shiftId]/publish/route.ts");
  const cancel = source("app/api/workforce/shifts/[shiftId]/cancel/route.ts");
  assert.match(create, /message === "ACCESS_DENIED"[\s\S]*?status: 403/);
  assert.match(create, /message === "SHIFT_OVERLAP"[\s\S]*?status: 409/);
  assert.match(create, /"WORKFORCE_REQUEST_ID_INVALID"[\s\S]*?status: 400/);
  assert.match(create, /message === "WORKFORCE_SCHEMA_NOT_PROVISIONED"[\s\S]*?status: 503/);
  assert.match(publish, /message === "SHIFT_INVALID_TRANSITION" \|\| message === "SHIFT_LEAVE_CONFLICT"[\s\S]*?status: 409/);
  assert.match(publish, /message === "SHIFT_NOT_FOUND"[\s\S]*?status: 404/);
  assert.match(cancel, /message === "SHIFT_INVALID_TRANSITION"[\s\S]*?status: 409/);
});

test("leave routes map every domain error to the correct HTTP status, including self-decision denial", () => {
  const create = source("app/api/workforce/leave/route.ts");
  const decide = source("app/api/workforce/leave/[leaveId]/decide/route.ts");
  const cancel = source("app/api/workforce/leave/[leaveId]/cancel/route.ts");
  assert.match(create, /message === "LEAVE_OVERLAP"[\s\S]*?status: 409/);
  assert.match(create, /"LEAVE_DATE_RANGE_INVALID"[\s\S]*?status: 400/);
  assert.match(decide, /message === "ACCESS_DENIED" \|\| message === "LEAVE_SELF_DECISION_FORBIDDEN"[\s\S]*?status: 403/);
  assert.match(decide, /message === "LEAVE_NOT_FOUND"[\s\S]*?status: 404/);
  assert.match(decide, /message === "LEAVE_INVALID_TRANSITION"[\s\S]*?status: 409/);
  assert.match(cancel, /message === "LEAVE_NOT_FOUND"[\s\S]*?status: 404/);
});

test("the decide route never coerces an invalid decision value into a silent Rejected outcome", () => {
  const decide = source("app/api/workforce/leave/[leaveId]/decide/route.ts");
  assert.doesNotMatch(decide, /decision: body\?\.decision === "Approved" \? "Approved" : "Rejected"/);
  assert.match(decide, /decision: body\?\.decision as "Approved" \| "Rejected"/);
});

test("every route rejects a disallowed request origin before touching any domain function", () => {
  const routes = [
    "app/api/workforce/shifts/route.ts",
    "app/api/workforce/shifts/[shiftId]/publish/route.ts",
    "app/api/workforce/shifts/[shiftId]/cancel/route.ts",
    "app/api/workforce/leave/route.ts",
    "app/api/workforce/leave/[leaveId]/decide/route.ts",
    "app/api/workforce/leave/[leaveId]/cancel/route.ts",
  ].map(source);
  for (const content of routes) {
    assert.match(content, /isAllowedRequestOrigin\(request\)/);
  }
});
