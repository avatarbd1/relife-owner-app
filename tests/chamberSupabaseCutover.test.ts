import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Chamber Supabase writes are tenant scoped and retry safe", () => {
  const migration = source(
    "supabase/migrations/20260816163300_chamber_booking_idempotency.sql"
  );
  const edge = source("supabase/functions/relife-chamber-api/index.ts");

  assert.match(migration, /add column if not exists request_id text/);
  assert.match(migration, /appointments_clinic_request_uidx/);
  assert.match(migration, /\(clinic_id, request_id\)/);

  assert.match(edge, /async function resolveTenant/);
  assert.match(edge, /clinic_id=\$\{tenant\.clinicId\}::uuid/);
  assert.match(edge, /request_id=\$\{requestId\}/);
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /duplicate: true/);
  assert.match(edge, /organization_id, clinic_id/);
});

test("Supabase booking cutover stays behind an explicit mode gate", () => {
  const scheduler = source("lib/domain/chamber/scheduler.ts");
  const board = source("lib/domain/chamber/board.ts");
  const config = source("lib/config/relifeSystem.ts");

  assert.match(scheduler, /chamberDbMode\(\) !== "supabase"/);
  assert.match(scheduler, /createSupabaseFixedHourBooking/);
  assert.match(scheduler, /mergeCutoverValidation/);
  assert.match(board, /Supabase wins on matching appointment IDs/);
  assert.match(board, /getSupabaseChamberBootstrap/);
  assert.match(config, /organizationSlug: "relife"/);
  assert.match(config, /clinicSlug: "amtali-main"/);
  assert.match(config, /separate from the legacy Sheets ledger/);
});
