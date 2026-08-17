import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THERAPIST_MANUAL_MINUTES,
  therapistIntervalsForTimeline,
  therapistIntervalsOverlap,
} from "../lib/domain/appointments/therapistCapacityRules.ts";

test("Manual Therapy reserves at least ten minutes of therapist capacity", () => {
  assert.equal(THERAPIST_MANUAL_MINUTES, 10);
  const intervals = therapistIntervalsForTimeline([
    { name: "Wax", resourceId: "WAX-01", startMinute: 600, endMinute: 610 },
    { name: "Manual Therapy", resourceId: "", startMinute: 611, endMinute: 616 },
    { name: "TENS", resourceId: "TENS-01", startMinute: 617, endMinute: 637 },
  ]);
  assert.deepEqual(intervals, [{ startMinute: 611, endMinute: 621 }]);
});

test("machine-only treatment does not block the therapist for the whole bed slot", () => {
  const intervals = therapistIntervalsForTimeline([
    { name: "Wax", resourceId: "WAX-01", startMinute: 600, endMinute: 610 },
    { name: "TENS", resourceId: "TENS-01", startMinute: 611, endMinute: 631 },
    { name: "SWD", resourceId: "SWD-01", startMinute: 632, endMinute: 647 },
  ]);
  assert.deepEqual(intervals, []);
});

test("general therapist session remains capacity-blocking", () => {
  const intervals = therapistIntervalsForTimeline([
    { name: "General session", resourceId: "", startMinute: 600, endMinute: 630 },
  ]);
  assert.deepEqual(intervals, [{ startMinute: 600, endMinute: 630 }]);
});

test("legacy appointment without timeline fails closed to its whole session", () => {
  const intervals = therapistIntervalsForTimeline([], { startMinute: 600, endMinute: 660 });
  assert.deepEqual(intervals, [{ startMinute: 600, endMinute: 660 }]);
});

test("same therapist can serve sequential non-overlapping manual windows", () => {
  const first = [{ startMinute: 610, endMinute: 620 }];
  const second = [{ startMinute: 620, endMinute: 630 }];
  assert.equal(therapistIntervalsOverlap(first, second), null);
});

test("same therapist overlap is detected at the exact treatment interval", () => {
  const overlap = therapistIntervalsOverlap(
    [{ startMinute: 610, endMinute: 620 }],
    [{ startMinute: 615, endMinute: 625 }]
  );
  assert.deepEqual(overlap, { startMinute: 615, endMinute: 620 });
});

test("unified appointment flow enforces therapist capacity before write", () => {
  const source = readFileSync(
    new URL("../lib/domain/appointments/create.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /applyTherapistCapacityValidation/);
  assert.match(source, /sheetValidationWithTherapist/);
  assert.match(source, /throwValidationConflict/);
});
