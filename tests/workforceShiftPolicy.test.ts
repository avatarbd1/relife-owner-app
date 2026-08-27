import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidIsoDate,
  isValidShiftTimeRange,
  isValidShiftTransition,
  shiftDateWithinLeaveRange,
  shiftOverlaps,
  timeToMinutes,
} from "../lib/domain/workforce/shiftPolicy.ts";

test("isValidIsoDate rejects malformed and impossible calendar dates", () => {
  assert.equal(isValidIsoDate("2026-08-22"), true);
  assert.equal(isValidIsoDate("2026-13-01"), false, "month 13 does not exist");
  assert.equal(isValidIsoDate("2026-02-30"), false, "Feb 30 does not exist");
  assert.equal(isValidIsoDate("22-08-2026"), false, "wrong format");
  assert.equal(isValidIsoDate(""), false);
});

test("timeToMinutes accepts 24h HH:MM only", () => {
  assert.equal(timeToMinutes("09:00"), 540);
  assert.equal(timeToMinutes("23:59"), 1439);
  assert.equal(timeToMinutes("24:00"), null, "24:00 is not a valid hour");
  assert.equal(timeToMinutes("9:00 AM"), null, "12h format is not accepted");
  assert.equal(timeToMinutes("bad"), null);
});

test("shift-create requirement: reject overnight/invalid time range (end > start required)", () => {
  assert.equal(isValidShiftTimeRange("09:00", "17:00"), true);
  assert.equal(isValidShiftTimeRange("22:00", "06:00"), false, "wraps past midnight");
  assert.equal(isValidShiftTimeRange("09:00", "09:00"), false, "zero-length shift");
  assert.equal(isValidShiftTimeRange("bad", "17:00"), false);
});

test("shift overlap: reject overlapping non-cancelled shifts for the same staff member", () => {
  const existing = [
    { shiftId: "SHF1", staffId: "S1", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00", status: "Published" as const },
  ];
  const overlap = shiftOverlaps(
    { staffId: "S1", shiftDate: "2026-08-22", startTime: "12:00", endTime: "15:00" },
    existing
  );
  assert.ok(overlap, "overlapping range for same staff/date must be rejected");
  assert.equal(overlap?.shiftId, "SHF1");
});

test("shift overlap: adjacent (touching, non-overlapping) shifts are allowed", () => {
  const existing = [
    { shiftId: "SHF1", staffId: "S1", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00", status: "Published" as const },
  ];
  const overlap = shiftOverlaps(
    { staffId: "S1", shiftDate: "2026-08-22", startTime: "13:00", endTime: "17:00" },
    existing
  );
  assert.equal(overlap, null, "end === next start is not an overlap");
});

test("shift overlap: different staff, different date, or Cancelled rows never conflict", () => {
  const existing = [
    { shiftId: "SHF1", staffId: "S2", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00", status: "Published" as const },
    { shiftId: "SHF2", staffId: "S1", shiftDate: "2026-08-23", startTime: "09:00", endTime: "13:00", status: "Published" as const },
    { shiftId: "SHF3", staffId: "S1", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00", status: "Cancelled" as const },
  ];
  const overlap = shiftOverlaps(
    { staffId: "S1", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00" },
    existing
  );
  assert.equal(overlap, null);
});

test("shift overlap: excludeShiftId lets a row ignore itself (used when re-validating an existing row)", () => {
  const existing = [
    { shiftId: "SHF1", staffId: "S1", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00", status: "Draft" as const },
  ];
  const overlap = shiftOverlaps(
    { staffId: "S1", shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00" },
    existing,
    "SHF1"
  );
  assert.equal(overlap, null);
});

test("shift transitions: only Draft->Published, Draft->Cancelled, Published->Cancelled are valid; nothing leaves Cancelled", () => {
  assert.equal(isValidShiftTransition("Draft", "Published"), true);
  assert.equal(isValidShiftTransition("Draft", "Cancelled"), true);
  assert.equal(isValidShiftTransition("Published", "Cancelled"), true);
  assert.equal(isValidShiftTransition("Published", "Draft"), false);
  assert.equal(isValidShiftTransition("Cancelled", "Draft"), false);
  assert.equal(isValidShiftTransition("Cancelled", "Published"), false);
  assert.equal(isValidShiftTransition("Draft", "Draft"), false, "no-op is not a declared transition");
});

test("publishing against Approved leave: shiftDateWithinLeaveRange is inclusive on both ends", () => {
  assert.equal(shiftDateWithinLeaveRange("2026-08-22", "2026-08-20", "2026-08-25"), true);
  assert.equal(shiftDateWithinLeaveRange("2026-08-20", "2026-08-20", "2026-08-25"), true, "range start is inclusive");
  assert.equal(shiftDateWithinLeaveRange("2026-08-25", "2026-08-20", "2026-08-25"), true, "range end is inclusive");
  assert.equal(shiftDateWithinLeaveRange("2026-08-26", "2026-08-20", "2026-08-25"), false);
});
