import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new Physio appointment flow uses simple gender-capacity booking", () => {
  const gate = source("components/AppointmentBookingGate.tsx");
  const form = source("components/AppointmentCapacityForm.tsx");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(gate, /AppointmentCapacityForm/);
  assert.match(gate, /Gender missing/);
  assert.match(form, /Simple Physio booking/);
  assert.match(form, /Checking gender capacity/);
  assert.match(form, /Therapist · optional/);
  assert.match(form, /\/api\/appointments\/capacity-booking/);
  assert.doesNotMatch(form, /requestedBedId/);
  assert.doesNotMatch(form, /BED-1/);
  assert.doesNotMatch(form, /Expected machine demand/);

  assert.match(capacity, /ROOM_CAPACITY/);
  assert.match(capacity, /gender_required/);
  assert.match(capacity, /type: "duplicate"/);
  assert.match(capacity, /Assigned_Bed_ID: ""/);
  assert.match(capacity, /Timeline_ID: ""/);
});

test("Physio booking capacity is hourly, gender-aware and capped at four", () => {
  const capacity = source("lib/domain/appointments/capacityBooking.ts");
  const workspace = source("components/AppointmentsWorkspaceClientV2.tsx");
  const board = source("components/ChamberCapacityBoard.tsx");

  assert.match(capacity, /GENERAL_SESSION_MIN = 60/);
  assert.match(capacity, /overlapping\.length >= 4/);
  assert.match(capacity, /No \$\{gender\} room capacity is available/);
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
  assert.doesNotMatch(handler, /requestedBedId/);
  assert.doesNotMatch(handler, /validateFixedHourBooking/);
  assert.doesNotMatch(handler, /createFixedHourBooking/);
});
