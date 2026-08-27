import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new appointment flow gates patient then shows configured booking", () => {
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
  assert.match(capacityUi, /Configured clinic booking/);
  assert.match(capacityUi, /Live Chamber treatment-time operation/);
  assert.doesNotMatch(capacityUi, /requestedBedId/);
});

test("Physio booking hours come from tenant configuration", () => {
  const configured = source("lib/domain/appointments/configuredBooking.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");
  assert.match(configured, /slot does not match configured interval/);
  assert.match(configured, /outside configured operating hours/);
  assert.match(capacity, /configuration\.operatingHours/);
});

test("legacy Chamber schedule API is compatibility-only and cannot reserve a bed", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(handler, /capacityBooking/);
  assert.doesNotMatch(handler, /record\.requestedBedId|body\.requestedBedId|requestedBedId\s*:/);
  assert.doesNotMatch(handler, /validateFixedHourBooking/);
  assert.doesNotMatch(handler, /createFixedHourBooking/);
  assert.match(capacity, /Assigned_Bed_ID: input\.resourceCode \|\| ""/);
  assert.match(capacity, /machineReservationsCreated: false/);
});
