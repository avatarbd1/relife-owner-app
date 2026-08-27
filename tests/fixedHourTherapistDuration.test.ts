import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("fixed-hour planner no longer fills selected machine plans with therapist time", () => {
  const fixedHour = source("lib/webos/chamberFixedHour.ts");
  assert.match(fixedHour, /if \(chosen\.length === 0 && remainingMin > 0\)/);
  assert.doesNotMatch(fixedHour, /name: chosen\.length \? "Therapist time"/);
});

test("fixed-hour therapist conflicts use treatment intervals rather than the whole hour", () => {
  const fixedHour = source("lib/webos/chamberFixedHour.ts");
  assert.match(fixedHour, /therapistIntervalsForTimeline/);
  assert.match(fixedHour, /therapistIntervalsOverlap/);
  assert.match(fixedHour, /state\.therapistSteps\.get\(item\.appointmentId\)/);
  assert.doesNotMatch(
    fixedHour,
    /const therapistBusy = overlapping\.find\(\(item\) => normalized\(item\.therapist\) === normalized\(therapist\)\);/
  );
});

test("fixed-hour manual therapy remains a ten-minute therapist reservation", () => {
  const fixedHour = source("lib/webos/chamberFixedHour.ts");
  assert.match(
    fixedHour,
    /value: MANUAL_ID, label: "Manual Therapy", durationMin: 10/
  );
  assert.match(fixedHour, /Booking_Validation_Version: "chamber-fixed-hour-v2"/);
});

test("live fixed-hour board does not invent therapist filler after selected modalities", () => {
  const board = source("components/ChamberHourlyBedBoard.tsx");
  assert.match(board, /if \(selected\.length === 0\) steps\.push/);
  assert.doesNotMatch(board, /selected\.length \? "Therapist time" : "Therapist session"/);
  assert.match(board, /elapsed >= 60/);
  assert.match(board, /\/ 60 min bed slot/);
});
