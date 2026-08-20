import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("canonical Physio booking stays on capacityBooking, not fixed-bed scheduling", () => {
  const route = source("app/api/appointments/capacity-booking/route.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(route, /@\/lib\/domain\/appointments\/capacityBooking/);
  assert.match(route, /createCapacityBooking/);
  assert.match(route, /validateCapacityBooking/);
  assert.doesNotMatch(route, /chamberFixedHour/);
  assert.doesNotMatch(route, /appointmentScheduling/);

  assert.match(capacity, /GENERAL_SESSION_MIN = 60/);
  assert.match(capacity, /GENERAL_TOLERANCE_MIN = 5/);
  assert.match(capacity, /machineReservationsCreated: false/);
  assert.doesNotMatch(capacity, /25_Machine_Reservations/);
  assert.doesNotMatch(capacity, /26_Treatment_Timeline/);
});

test("legacy Chamber booking HTTP paths delegate to capacity booking only", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");

  assert.match(handler, /@\/lib\/domain\/appointments\/capacityBooking/);
  assert.match(handler, /createCapacityBooking/);
  assert.match(handler, /validateCapacityBooking/);
  assert.doesNotMatch(handler, /createFixedHourBooking/);
  assert.doesNotMatch(handler, /validateFixedHourBooking/);
  assert.doesNotMatch(handler, /createUnifiedPhysioBooking/);
  assert.doesNotMatch(handler, /requestedBedId:/);

  for (const path of [
    "app/api/chamber/fixed-hour/route.ts",
    "app/api/chamber/hourly-booking/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /chamberSchedulePost/);
    assert.doesNotMatch(route, /validateFixedHourBooking/);
    assert.doesNotMatch(route, /validateHourlyBedBooking/);
    assert.doesNotMatch(route, /createFixedHourBooking/);
    assert.doesNotMatch(route, /createHourlyBedBooking/);
  }
});

test("legacy Chamber scheduler is a thin capacity-booking adapter", () => {
  const scheduler = source("lib/domain/chamber/scheduler.ts");

  assert.match(scheduler, /@\/lib\/domain\/appointments\/capacityBooking/);
  assert.match(scheduler, /createCapacityBooking/);
  assert.match(scheduler, /validateCapacityBooking/);
  assert.doesNotMatch(scheduler, /createFixedHourBooking/);
  assert.doesNotMatch(scheduler, /validateFixedHourBooking/);
  assert.doesNotMatch(scheduler, /createSupabaseFixedHourBooking/);
  assert.doesNotMatch(scheduler, /validateFixedHourBookingWithSupabase/);
});

test("migration hourly module is read-only and cannot create bookings", () => {
  const hourly = source("lib/webos/chamberHourlyBooking.ts");
  assert.match(hourly, /getHourlyBedBoard/);
  assert.match(hourly, /chamberHourSlots/);
  assert.doesNotMatch(hourly, /export async function validateHourlyBedBooking/);
  assert.doesNotMatch(hourly, /export async function createHourlyBedBooking/);
  assert.doesNotMatch(hourly, /appointmentScheduling/);
});

test("live Chamber runtime owns treatment execution, not booking", () => {
  const runtime = source("lib/domain/chamber/runtime.ts");

  assert.match(runtime, /receiveChamberRuntimePatient/);
  assert.match(runtime, /startChamberRuntimeSession/);
  assert.match(runtime, /updateChamberRuntimeStep/);
  assert.match(runtime, /completeChamberRuntimeSession/);
  assert.doesNotMatch(runtime, /createCapacityBooking/);
});
