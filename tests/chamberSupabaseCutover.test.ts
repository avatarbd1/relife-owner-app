import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("historical Chamber booking schema remains tenant scoped and retry safe", () => {
  const migration = source(
    "supabase/migrations/20260816163300_chamber_booking_idempotency.sql"
  );
  const edge = source("supabase/functions/relife-chamber-api/index.ts");

  assert.match(migration, /add column if not exists request_id text/);
  assert.match(migration, /appointments_clinic_request_uidx/);
  assert.match(migration, /\(clinic_id, request_id\)/);
  assert.match(edge, /async function resolveTenant/);
  assert.match(edge, /clinic_id=\$\{tenant\.clinicId\}::uuid/);
  assert.match(edge, /pg_advisory_xact_lock/);
});

test("active Physio booking does not use the old fixed-bed Supabase cutover", () => {
  const scheduler = source("lib/domain/chamber/scheduler.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");
  const board = source("lib/domain/chamber/board.ts");
  const config = source("lib/config/relifeSystem.ts");

  assert.match(scheduler, /@\/lib\/domain\/appointments\/capacityBooking/);
  assert.match(scheduler, /createCapacityBooking/);
  assert.doesNotMatch(scheduler, /createSupabaseFixedHourBooking/);
  assert.doesNotMatch(scheduler, /mergeCutoverValidation/);
  assert.match(capacity, /Assigned_Bed_ID: input\.resourceCode \|\| ""/);
  assert.match(capacity, /machineReservationsCreated: false/);

  // Supabase board/runtime cutover remains available for live operational data.
  assert.match(board, /getSupabaseChamberBootstrap/);
  assert.match(config, /organizationSlug: "relife"/);
  assert.match(config, /clinicSlug: "amtali-main"/);
});
