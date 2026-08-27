import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THERAPIST_MANUAL_MINUTES,
  therapistIntervalsForTimeline,
  therapistIntervalsOverlap,
} from "../lib/domain/appointments/therapistCapacityRules.ts";

test("Manual Therapy helper keeps a ten-minute therapist interval for live/legacy planning", () => {
  assert.equal(THERAPIST_MANUAL_MINUTES, 10);
  const intervals = therapistIntervalsForTimeline([
    { name: "Wax", resourceId: "WAX-01", startMinute: 600, endMinute: 610 },
    { name: "Manual Therapy", resourceId: "", startMinute: 611, endMinute: 616 },
    { name: "TENS", resourceId: "TENS-01", startMinute: 617, endMinute: 637 },
  ]);
  assert.deepEqual(intervals, [{ startMinute: 611, endMinute: 621 }]);
});

test("machine-only treatment does not occupy therapist intervals", () => {
  const intervals = therapistIntervalsForTimeline([
    { name: "Wax", resourceId: "WAX-01", startMinute: 600, endMinute: 610 },
    { name: "TENS", resourceId: "TENS-01", startMinute: 611, endMinute: 631 },
    { name: "SWD", resourceId: "SWD-01", startMinute: 632, endMinute: 647 },
  ]);
  assert.deepEqual(intervals, []);
});

test("general therapist session can still be represented by the runtime helper", () => {
  const intervals = therapistIntervalsForTimeline([
    { name: "General session", resourceId: "", startMinute: 600, endMinute: 630 },
  ]);
  assert.deepEqual(intervals, [{ startMinute: 600, endMinute: 630 }]);
});

test("legacy appointment without timeline fails closed inside the interval helper", () => {
  const intervals = therapistIntervalsForTimeline([], { startMinute: 600, endMinute: 660 });
  assert.deepEqual(intervals, [{ startMinute: 600, endMinute: 660 }]);
});

test("same therapist can serve sequential non-overlapping manual windows", () => {
  const first = [{ startMinute: 610, endMinute: 620 }];
  const second = [{ startMinute: 620, endMinute: 630 }];
  assert.equal(therapistIntervalsOverlap(first, second), null);
});

test("same therapist overlap helper detects the exact treatment interval", () => {
  const overlap = therapistIntervalsOverlap(
    [{ startMinute: 610, endMinute: 620 }],
    [{ startMinute: 615, endMinute: 625 }]
  );
  assert.deepEqual(overlap, { startMinute: 615, endMinute: 620 });
});

test("reception booking treats therapist overlap as advisory, not a hard block", () => {
  const capacity = readFileSync(
    new URL("../lib/domain/appointments/capacityBooking.ts", import.meta.url),
    "utf8"
  );
  const route = readFileSync(
    new URL("../app/api/appointments/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(capacity, /type: "therapist_load"/);
  assert.match(capacity, /Booking is still allowed/);
  assert.match(route, /createCapacityBooking/);
  assert.doesNotMatch(route, /createUnifiedPhysioBooking/);
});
