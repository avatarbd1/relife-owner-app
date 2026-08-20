import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("generic Physio appointment create uses the same capacity-booking authority", () => {
  const route = source("app/api/appointments/route.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");
  const hours = source("lib/domain/chamber/hours.ts");

  assert.match(route, /createCapacityBooking/);
  assert.match(route, /capacity-booking:/);
  assert.doesNotMatch(route, /createUnifiedPhysioBooking/);
  assert.match(capacity, /validateCapacityBooking/);
  assert.match(capacity, /createCapacityBooking/);
  assert.match(capacity, /if \(!isPhysioChamberStart\(input\.time\)\) throw new Error\("INVALID_SLOT"\)/);
  assert.match(hours, /PHYSIO_CHAMBER_STARTS/);
  assert.match(hours, /"09:00"/);
  assert.match(hours, /"20:00"/);
  assert.doesNotMatch(hours, /"13:00"/);
  assert.doesNotMatch(hours, /"14:00"/);
});

test("generic Physio validation does not expose machine or fixed-bed planning", () => {
  const validateRoute = source("app/api/appointments/validate/route.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(validateRoute, /validateCapacityBooking/);
  assert.doesNotMatch(validateRoute, /validateUnifiedPhysioBooking/);
  assert.doesNotMatch(validateRoute, /getBookingProfile/);
  assert.match(validateRoute, /suggestedModalities: \[\]/);
  assert.match(validateRoute, /modalityOptions: \[\]/);
  assert.match(capacity, /Assigned_Bed_ID: ""/);
  assert.match(capacity, /Timeline_ID: ""/);
  assert.match(capacity, /machineReservationsCreated: false/);
});

test("historical appointment transaction code remains audited but is not the active receptionist booking writer", () => {
  const edge = source("supabase/functions/relife-appointment-api/index.ts");
  const migration = source(
    "supabase/migrations/20260816173500_appointment_transaction_audit.sql"
  );
  const data = source("lib/data/supabaseChamber.ts");

  assert.match(edge, /insert into relife\.audit_events/);
  assert.match(migration, /create table if not exists relife\.audit_events/);
  assert.match(migration, /enable row level security/);
  assert.match(data, /relife-appointment-api/);
  assert.match(data, /RELIFE_CHAMBER_DB_MODE \|\| "sheets"/);
});

test("legacy Chamber scheduler accepts old request fields but ignores fixed-bed booking policy", () => {
  const scheduler = source("lib/domain/chamber/scheduler.ts");
  const handler = source("app/api/chamber/schedule/handler.ts");

  assert.match(scheduler, /requestedBedId\?: string/);
  assert.match(scheduler, /modalities\?: string\[\]/);
  assert.match(scheduler, /requestId\?: string/);
  assert.match(scheduler, /createCapacityBooking/);
  assert.doesNotMatch(scheduler, /stableRequestId/);
  assert.doesNotMatch(scheduler, /createSupabaseFixedHourBooking/);
  assert.doesNotMatch(handler, /record\.requestedBedId|body\.requestedBedId|requestedBedId\s*:/);
});
