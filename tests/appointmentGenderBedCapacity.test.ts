import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new Physio appointment flow uses configured clinic booking", () => {
  const gate = source("components/AppointmentBookingGate.tsx");
  const form = source("components/AppointmentCapacityForm.tsx");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(gate, /AppointmentCapacityForm/);
  assert.match(gate, /Gender missing/);
  assert.match(form, /Configured clinic booking/);
  assert.match(form, /api\/settings\/facility/);
  assert.match(form, /providerRequired/);
  assert.match(form, /\/api\/appointments\/capacity-booking/);
  assert.doesNotMatch(form, /requestedBedId/);
  assert.doesNotMatch(form, /BED-1/);
  assert.doesNotMatch(form, /Expected machine demand/);

  assert.match(capacity, /resolveConfiguredBooking/);
  assert.doesNotMatch(capacity, /ROOM_CAPACITY/);
  assert.match(capacity, /Assigned_Bed_ID: input\.resourceCode \|\| ""/);
  assert.match(capacity, /Timeline_ID: ""/);
});

test("Physio booking capacity and duration come from clinic configuration", () => {
  const capacity = source("lib/domain/appointments/capacityBooking.ts");
  const workspace = source("components/AppointmentsWorkspaceClientV2.tsx");
  const board = source("components/ChamberCapacityBoard.tsx");

  assert.match(capacity, /configuration\.booking\?\.defaultDurationMin/);
  assert.match(capacity, /configuration\.operatingHours/);
  assert.doesNotMatch(capacity, /overlapping\.length >= 4/);
  assert.match(workspace, /Physio capacity · gender-wise/);
  assert.match(board, /Male \{male\}/);
  assert.match(board, /Female \{female\}/);
  assert.match(board, /Hard block happens only when gender\/room capacity or duplicate-patient conflict is unsafe/);
});

test("legacy Chamber booking endpoint delegates to capacity booking instead of fixed beds", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");

  assert.match(handler, /@\/lib\/domain\/appointments\/capacityBooking/);
  assert.match(handler, /validateCapacityBooking/);
  assert.match(handler, /createCapacityBooking/);
  assert.doesNotMatch(handler, /record\.requestedBedId|body\.requestedBedId|requestedBedId\s*:/);
  assert.doesNotMatch(handler, /validateFixedHourBooking/);
  assert.doesNotMatch(handler, /createFixedHourBooking/);
});
