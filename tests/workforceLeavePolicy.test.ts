import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAVE_DECISION_NOTE_MAX_LENGTH,
  LEAVE_REASON_MAX_LENGTH,
  boundedDecisionNote,
  boundedReason,
  isValidLeaveDateRange,
  isValidLeaveTransition,
  leaveOverlaps,
} from "../lib/domain/workforce/leavePolicy.ts";

test("isValidLeaveDateRange requires two real ISO dates with end >= start (inclusive, single-day allowed)", () => {
  assert.equal(isValidLeaveDateRange("2026-08-22", "2026-08-22"), true, "single-day leave");
  assert.equal(isValidLeaveDateRange("2026-08-22", "2026-08-25"), true);
  assert.equal(isValidLeaveDateRange("2026-08-25", "2026-08-22"), false, "end before start");
  assert.equal(isValidLeaveDateRange("2026-13-01", "2026-08-25"), false, "invalid start date");
  assert.equal(isValidLeaveDateRange("2026-08-22", ""), false);
});

test("bounded reason/decision-note text is trimmed and length-capped", () => {
  assert.equal(boundedReason("  fever  "), "fever");
  assert.equal(boundedReason("x".repeat(1000)).length, LEAVE_REASON_MAX_LENGTH);
  assert.equal(boundedDecisionNote("x".repeat(1000)).length, LEAVE_DECISION_NOTE_MAX_LENGTH);
});

test("leave overlap: reject overlap with an active (Pending/Approved) request for the same staff", () => {
  const existing = [
    { leaveId: "LVE1", staffId: "S1", startDate: "2026-08-20", endDate: "2026-08-25", status: "Pending" as const },
  ];
  const overlap = leaveOverlaps({ staffId: "S1", startDate: "2026-08-23", endDate: "2026-08-27" }, existing);
  assert.ok(overlap);
  assert.equal(overlap?.leaveId, "LVE1");
});

test("leave overlap: Rejected/Cancelled (terminal) requests never block a new one", () => {
  const existing = [
    { leaveId: "LVE1", staffId: "S1", startDate: "2026-08-20", endDate: "2026-08-25", status: "Rejected" as const },
    { leaveId: "LVE2", staffId: "S1", startDate: "2026-08-20", endDate: "2026-08-25", status: "Cancelled" as const },
  ];
  const overlap = leaveOverlaps({ staffId: "S1", startDate: "2026-08-22", endDate: "2026-08-23" }, existing);
  assert.equal(overlap, null);
});

test("leave overlap: different staff or non-overlapping ranges never conflict", () => {
  const existing = [
    { leaveId: "LVE1", staffId: "S2", startDate: "2026-08-20", endDate: "2026-08-25", status: "Approved" as const },
    { leaveId: "LVE2", staffId: "S1", startDate: "2026-09-01", endDate: "2026-09-05", status: "Approved" as const },
  ];
  const overlap = leaveOverlaps({ staffId: "S1", startDate: "2026-08-20", endDate: "2026-08-25" }, existing);
  assert.equal(overlap, null);
});

test("leave overlap: excludeLeaveId lets a row ignore itself", () => {
  const existing = [
    { leaveId: "LVE1", staffId: "S1", startDate: "2026-08-20", endDate: "2026-08-25", status: "Pending" as const },
  ];
  const overlap = leaveOverlaps(
    { staffId: "S1", startDate: "2026-08-20", endDate: "2026-08-25" },
    existing,
    "LVE1"
  );
  assert.equal(overlap, null);
});

test("leave transitions: only Pending->Approved/Rejected/Cancelled are valid; every terminal state is final", () => {
  assert.equal(isValidLeaveTransition("Pending", "Approved"), true);
  assert.equal(isValidLeaveTransition("Pending", "Rejected"), true);
  assert.equal(isValidLeaveTransition("Pending", "Cancelled"), true);
  assert.equal(isValidLeaveTransition("Approved", "Rejected"), false, "repeated/second decision fails closed");
  assert.equal(isValidLeaveTransition("Approved", "Cancelled"), false);
  assert.equal(isValidLeaveTransition("Rejected", "Approved"), false);
  assert.equal(isValidLeaveTransition("Cancelled", "Approved"), false);
  assert.equal(isValidLeaveTransition("Pending", "Pending"), false);
});
