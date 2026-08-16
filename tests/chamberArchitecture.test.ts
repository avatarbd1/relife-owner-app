import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("canonical Chamber schedule handler uses domain scheduler", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  assert.match(handler, /@\/lib\/domain\/chamber\/scheduler/);
  assert.doesNotMatch(handler, /chamberFixedHour/);
  assert.doesNotMatch(handler, /chamberHourlyBooking/);
});

test("legacy Chamber booking APIs are thin compatibility adapters", () => {
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

test("migration hourly module is read-only and cannot create bookings", () => {
  const hourly = source("lib/webos/chamberHourlyBooking.ts");
  assert.match(hourly, /getHourlyBedBoard/);
  assert.match(hourly, /chamberHourSlots/);
  assert.doesNotMatch(hourly, /export async function validateHourlyBedBooking/);
  assert.doesNotMatch(hourly, /export async function createHourlyBedBooking/);
  assert.doesNotMatch(hourly, /appointmentScheduling/);
});

test("only the Chamber scheduler facade directly owns fixed-hour booking commands", () => {
  const scheduler = source("lib/domain/chamber/scheduler.ts");
  assert.match(scheduler, /validateFixedHourBooking/);
  assert.match(scheduler, /createFixedHourBooking/);
  assert.match(scheduler, /withMutationLock/);
});
