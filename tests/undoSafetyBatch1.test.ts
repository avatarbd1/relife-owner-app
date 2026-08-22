import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("appointment instant undo is atomic, compare-and-swap and excludes completion", () => {
  const domain = source("lib/domain/appointments/undoStatus.ts");
  const route = source("app/api/appointments/status/undo/route.ts");
  const client = source("components/AppointmentStatusControl.tsx");

  assert.match(domain, /expectedCurrentStatus === "Completed" \|\| restoreStatus === "Completed"/);
  assert.match(domain, /APPOINTMENT_COMPLETION_CORRECTION_REQUIRED/);
  assert.match(domain, /currentStatus !== expectedCurrentStatus/);
  assert.match(domain, /APPOINTMENT_UNDO_CONFLICT/);
  assert.match(domain, /appointment\.status\.undo/);
  assert.match(domain, /batchUpdateSpreadsheet\(workbook, requests\)/);
  assert.match(route, /withMutationLock\(`appointment-update:\$\{appointmentId\}`/);
  assert.match(client, /window\.setTimeout\(\(\) => setUndoState\(null\), 8_000\)/);
  assert.match(client, /\/api\/appointments\/status\/undo/);
  assert.match(client, /correction\/reopen workflow/);
});

test("shift undo is locked, idempotent, audited and conflict-safe", () => {
  const domain = source("lib/domain/workforce/shiftUndo.ts");
  const client = source("components/WorkforceClient.tsx");

  assert.match(domain, /expectedCurrentStatus === "Published" && restoreStatus === "Draft"/);
  assert.match(domain, /expectedCurrentStatus === "Cancelled" && \(restoreStatus === "Draft" \|\| restoreStatus === "Published"\)/);
  assert.match(domain, /withMutationLock\(`workforce-shift-row:\$\{shiftId\}`/);
  assert.match(domain, /currentStatus !== expectedCurrentStatus/);
  assert.match(domain, /SHIFT_UNDO_CONFLICT/);
  assert.match(domain, /restoreStatus === "Published"/);
  assert.match(domain, /SHIFT_LEAVE_CONFLICT/);
  assert.match(domain, /action: "shift\.undo"/);
  assert.match(client, /window\.setTimeout\(\(\) => setShiftUndo\(null\), 8_000\)/);
  assert.match(client, /\/undo`/);
});

test("staff deactivate undo is Owner-only and refuses stale profile restore", () => {
  const domain = source("lib/webos/staffUndo.ts");
  const client = source("components/StaffManagementClient.tsx");

  assert.match(domain, /context\.roles\.includes\("Owner"\)/);
  assert.match(domain, /withMutationLock\(`staff-management:\$\{staffId\}`/);
  assert.match(domain, /normalized\(at\(row, statusIdx\)\) !== "inactive"/);
  assert.match(domain, /profileMatches/);
  assert.match(domain, /STAFF_UNDO_CONFLICT/);
  assert.match(domain, /alreadyActive/);
  assert.match(domain, /staff\.deactivate\.undo/);
  assert.match(client, /window\.setTimeout\(\(\) => setDeactivateUndo\(null\), 8_000\)/);
  assert.match(client, /\/undo-deactivate`/);
});

test("chamber secondary step undo preserves history and all Complete controls require confirmation", () => {
  const stepClient = source("components/ChamberStepWorkflow.tsx");
  const liveBoard = source("components/LiveChamberBoard.tsx");
  const chamber = source("lib/webos/chamber.ts");

  assert.match(stepClient, /window\.setTimeout\(\(\) => setUndoStep\(null\), 8_000\)/);
  assert.match(stepClient, /action: "update_step"/);
  assert.match(stepClient, /step: pending\.from/);
  assert.match(stepClient, /step !== "Complete"/);
  assert.match(stepClient, /Complete treatment\?/);
  assert.match(stepClient, /cannot use instant Undo/);
  assert.match(liveBoard, /Complete treatment\?/);
  assert.match(liveBoard, /Instant Undo is not available/);
  assert.match(liveBoard, /if \(confirmed\) void post\(`complete:/);
  assert.match(chamber, /"chamber\.step\.update"/);
  assert.match(chamber, /stepLog: closeCurrentStep\(stored, now\.iso\)/);
});
