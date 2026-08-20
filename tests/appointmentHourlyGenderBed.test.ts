import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new appointment flow gates missing gender then shows simple Physio capacity booking", () => {
  const page = source("app/(dashboard)/appointments/new/page.tsx");
  const gate = source("components/AppointmentBookingGate.tsx");
  const capacityUi = source("components/AppointmentCapacityForm.tsx");

  assert.match(page, /AppointmentBookingGate/);
  assert.match(gate, /Patient select করুন/);
  assert.match(gate, /Gender missing/);
  assert.match(gate, /saveGender\("Male"\)/);
  assert.match(gate, /saveGender\("Female"\)/);
  assert.match(gate, /AppointmentCapacityForm/);
  assert.match(capacityUi, /Appointment hour/);
  assert.match(capacityUi, /Simple Physio booking · 60 ± 5 min/);
  assert.match(capacityUi, /Live Chamber handle করবে/);
  assert.doesNotMatch(capacityUi, /requestedBedId/);
});

test("Physio booking hours remain canonical hourly starts", () => {
  const hours = source("lib/domain/chamber/hours.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(hours, /"09:00"/);
  assert.match(hours, /"10:00"/);
  assert.match(hours, /"20:00"/);
  assert.doesNotMatch(hours, /"09:30"/);
  assert.doesNotMatch(hours, /"10:30"/);
  assert.match(capacity, /if \(!isPhysioChamberStart\(input\.time\)\) throw new Error\("INVALID_SLOT"\)/);
});

test("legacy Chamber schedule API is compatibility-only and cannot reserve a bed", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(handler, /capacityBooking/);
  assert.doesNotMatch(handler, /requestedBedId/);
  assert.doesNotMatch(handler, /validateFixedHourBooking/);
  assert.doesNotMatch(handler, /createFixedHourBooking/);
  assert.match(capacity, /Assigned_Bed_ID: ""/);
  assert.match(capacity, /machineReservationsCreated: false/);
});
