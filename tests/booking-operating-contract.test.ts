import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const capacitySource = fs.readFileSync("lib/domain/appointments/capacityBooking.ts", "utf8");
const capacityUiSource = fs.readFileSync("components/AppointmentCapacityForm.tsx", "utf8");
const bookingGateSource = fs.readFileSync("components/AppointmentBookingGate.tsx", "utf8");
const chamberCompatibilitySource = fs.readFileSync("app/api/chamber/schedule/handler.ts", "utf8");
const machineSource = fs.readFileSync("lib/webos/machineRuntime.ts", "utf8");
const liveSource = fs.readFileSync("components/LiveChamberBoard.tsx", "utf8");

test("Physio capacity booking keeps 60 ± 5 and no machine reservation writes", () => {
  assert.match(capacitySource, /GENERAL_SESSION_MIN = 60/);
  assert.match(capacitySource, /GENERAL_TOLERANCE_MIN = 5/);
  assert.match(capacitySource, /machineReservationsCreated: false/);
  assert.doesNotMatch(capacitySource, /25_Machine_Reservations/);
  assert.doesNotMatch(capacitySource, /26_Treatment_Timeline/);
});

test("Reception Physio booking remains simple and does not ask for bed or machine timing", () => {
  assert.match(bookingGateSource, /AppointmentCapacityForm/);
  assert.match(capacityUiSource, /Bed, machine, treatment sequence/);
  assert.match(capacityUiSource, /Therapist · optional/);
  assert.match(capacityUiSource, /Therapist overlap booking block করবে না/);
  assert.doesNotMatch(capacityUiSource, /Expected machine demand/);
  assert.doesNotMatch(capacityUiSource, /requestedBedId/);
  assert.doesNotMatch(capacityUiSource, /Check beds/);
});

test("legacy Chamber booking endpoint cannot reactivate fixed-bed booking", () => {
  assert.match(chamberCompatibilitySource, /capacityBooking/);
  assert.doesNotMatch(chamberCompatibilitySource, /chamberFixedHour/);
  assert.doesNotMatch(chamberCompatibilitySource, /appointmentScheduling/);
  assert.doesNotMatch(chamberCompatibilitySource, /createUnifiedPhysioBooking/);
});

test("Traction is a 20 minute machine and releases the general station", () => {
  assert.match(machineSource, /TRACTION_MINUTES = 20/);
  assert.match(machineSource, /setCell\(next, runtime\.sessionRows\[0\], "Station_ID", ""\)/);
  assert.match(machineSource, /setCell\(next, runtime\.sessionRows\[0\], "Room_ID", ""\)/);
});

test("Routine live UI does not ask therapist to pick a bed or advance step workflow", () => {
  assert.doesNotMatch(liveSource, /WaitingBedPicker/);
  assert.doesNotMatch(liveSource, /ChamberStepWorkflow/);
  assert.match(liveSource, /Start Treatment/);
  assert.match(liveSource, /Complete Treatment/);
});
