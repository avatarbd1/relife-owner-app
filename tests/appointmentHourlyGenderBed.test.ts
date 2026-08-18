import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression contract: Physio stays hourly, missing gender is recoverable inline,
// and an explicitly clicked Chamber bed must remain the requested bed.
function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new appointment flow gates on patient and missing Physio gender before showing booking slots", () => {
  const page = source("app/(dashboard)/appointments/new/page.tsx");
  const gate = source("components/AppointmentBookingGate.tsx");
  assert.match(page, /AppointmentBookingGate/);
  assert.match(gate, /Patient select করুন/);
  assert.match(gate, /Gender missing/);
  assert.match(gate, /saveGender\("Male"\)/);
  assert.match(gate, /saveGender\("Female"\)/);
  assert.match(gate, /\/api\/patients\//);
  assert.match(gate, /Hourly slots/);
  assert.match(gate, /patients=\{\[gatedPatient\]\}/);
});

test("Physio chamber source remains hourly", () => {
  const hours = source("lib/domain/chamber/hours.ts");
  assert.match(hours, /"09:00"/);
  assert.match(hours, /"10:00"/);
  assert.match(hours, /"11:00"/);
  assert.doesNotMatch(hours, /"09:30"/);
  assert.doesNotMatch(hours, /"10:30"/);
});

test("explicit chamber bed clicks keep requested bed instead of falling back to auto-assignment", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  const board = source("components/ChamberHourlyBedBoard.tsx");
  assert.match(board, /requestedBedId: openSlot\.bedId/);
  assert.match(handler, /requestedBedId = String\(record\.requestedBedId/);
  assert.match(handler, /validateFixedHourBooking\(context, parseFixedBedInput\(record\)\)/);
  assert.match(handler, /createFixedHourBooking\(context, parseFixedBedInput\(record\)\)/);
});
