import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression contract: Physio keeps canonical appointment hours, missing gender is
// recoverable inline, and the visible booking path uses gender/room capacity
// rather than asking the user to reserve a fixed bed or machine.
function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new appointment flow gates on patient and missing Physio gender before showing capacity booking", () => {
  const page = source("app/(dashboard)/appointments/new/page.tsx");
  const gate = source("components/AppointmentBookingGate.tsx");
  const capacity = source("components/AppointmentCapacityForm.tsx");
  assert.match(page, /AppointmentBookingGate/);
  assert.match(gate, /Patient select করুন/);
  assert.match(gate, /Gender missing/);
  assert.match(gate, /saveGender\("Male"\)/);
  assert.match(gate, /saveGender\("Female"\)/);
  assert.match(gate, /\/api\/patients\//);
  assert.match(gate, /AppointmentCapacityForm/);
  assert.match(capacity, /Appointment hour/);
  assert.match(capacity, /General treatment · 60 ± 5 min/);
  assert.match(capacity, /exact time reserve হয় না/);
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

test("legacy explicit chamber bed handler remains available only for rollback compatibility", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  const board = source("components/ChamberHourlyBedBoard.tsx");
  assert.match(board, /requestedBedId: openSlot\.bedId/);
  assert.match(handler, /requestedBedId = String\(record\.requestedBedId/);
  assert.match(handler, /validateFixedHourBooking\(\s*context,\s*parseFixedBedInput\(record\)\s*\)/);
  assert.match(handler, /createFixedHourBooking\(context, parseFixedBedInput\(record\)\)/);
});
