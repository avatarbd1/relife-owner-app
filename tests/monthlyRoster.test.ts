import test from "node:test";
import assert from "node:assert/strict";
import {
  generateMonthlyRoster,
  MONTHLY_ROSTER_PROFILES,
  monthlyRosterConflictCodes,
  ROLE_SHIFT_SEGMENTS,
} from "../lib/domain/workforce/monthlyRoster.ts";

test("monthly roster uses the exact operational IDs and Avro 12:00-18:00 override", () => {
  assert.deepEqual(MONTHLY_ROSTER_PROFILES.map((item) => item.staffId), [
    "ST002", "ST003", "ST004", "ST005", "ST007", "ST008", "ST010", "ST011",
  ]);
  const entries = generateMonthlyRoster("2026-09");
  const avroFullDay = entries.find((item) => item.staffId === "ST004" && !item.weeklyHalfDay);
  assert.equal(avroFullDay?.startTime, "12:00");
  assert.equal(avroFullDay?.endTime, "18:00");
  assert.deepEqual(ROLE_SHIFT_SEGMENTS.Manager, [{ startTime: "12:00", endTime: "18:00" }]);
  assert.throws(() => generateMonthlyRoster("2026-13"), /ROSTER_MONTH_INVALID/);
});

test("weekly half-days are deterministic and staggered instead of one shared day", () => {
  const first = generateMonthlyRoster("2026-09");
  const second = generateMonthlyRoster("2026-09");
  assert.deepEqual(first, second);
  const halfDaysByStaff = new Map<string, Set<string>>();
  for (const entry of first.filter((item) => item.weeklyHalfDay)) {
    const dates = halfDaysByStaff.get(entry.staffId) || new Set<string>();
    dates.add(entry.shiftDate);
    halfDaysByStaff.set(entry.staffId, dates);
  }
  assert.equal(halfDaysByStaff.size, MONTHLY_ROSTER_PROFILES.length);
  const firstHalfDayDates = new Set([...halfDaysByStaff.values()].map((dates) => [...dates][0]));
  assert.ok(firstHalfDayDates.size > 1);
});

test("preview reports existing shift and Approved leave conflicts without mutating the plan", () => {
  const entries = generateMonthlyRoster("2026-09");
  const target = entries[0];
  const conflicts = monthlyRosterConflictCodes({
    entries,
    existing: [{
      shiftId: "SHF1",
      staffId: target.staffId,
      shiftDate: target.shiftDate,
      startTime: target.startTime,
      endTime: target.endTime,
      status: "Published",
    }],
    approvedLeave: [{ staffId: "ST004", startDate: "2026-09-10", endDate: "2026-09-10" }],
  });
  assert.ok(conflicts.some((item) => item.startsWith("SHIFT_OVERLAP:")));
  assert.ok(conflicts.includes("SHIFT_LEAVE_CONFLICT:ST004:2026-09-10"));
});
