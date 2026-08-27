import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("#69 routes live Chamber through one cutover runtime boundary", () => {
  const route = source("app/api/chamber/route.ts");
  const runtime = source("lib/domain/chamber/runtime.ts");

  assert.match(route, /@\/lib\/domain\/chamber\/runtime/);
  assert.match(route, /getChamberRuntimeSnapshot/);
  assert.match(route, /receiveChamberRuntimePatient/);
  assert.match(route, /startChamberRuntimeSession/);
  assert.match(route, /completeChamberRuntimeSession/);
  assert.match(runtime, /receiveSupabaseChamberSession/);
  assert.match(runtime, /startSupabaseChamberSession/);
  assert.match(runtime, /updateSupabaseChamberSessionStep/);
  assert.match(runtime, /completeSupabaseChamberSession/);
  assert.match(runtime, /withMutationLock/);
  assert.match(runtime, /receiveSheetsChamberPatient/);
});

test("Supabase runtime transitions are transactional, tenant scoped and audited", () => {
  const edge = source("supabase/functions/relife-chamber-runtime-api/index.ts");

  for (const action of ["receive", "start", "step", "complete"]) {
    assert.match(edge, new RegExp(`action === \\"${action}\\"`));
  }
  assert.match(edge, /sql\.begin/);
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /clinic_id=\$\{tenant\.clinicId\}::uuid/);
  assert.match(edge, /insert into relife\.chamber_sessions/);
  assert.match(edge, /update relife\.appointments/);
  assert.match(edge, /insert into relife\.audit_events/);
  assert.match(edge, /status='Completed'/);
});

test("booking compatibility does not reactivate fixed-bed Supabase writes", () => {
  const handler = source("app/api/chamber/schedule/handler.ts");
  const scheduler = source("lib/domain/chamber/scheduler.ts");
  const capacity = source("lib/domain/appointments/capacityBooking.ts");

  assert.match(handler, /capacityBooking/);
  assert.match(scheduler, /capacityBooking/);
  assert.match(capacity, /machineReservationsCreated: false/);
  assert.doesNotMatch(handler, /createSupabaseFixedHourBooking/);
  assert.doesNotMatch(scheduler, /createSupabaseFixedHourBooking/);
  assert.doesNotMatch(scheduler, /stableRequestId/);
});

test("exact Supabase board mode still fails closed instead of hiding runtime data", () => {
  const board = source("lib/domain/chamber/board.ts");
  assert.match(board, /chamberDbMode\(\) !== "supabase"/);
  assert.match(board, /SUPABASE_EDGE_SECRET_MISSING/);
  assert.match(board, /getSupabaseChamberBootstrap/);
  assert.doesNotMatch(board, /fallback to Sheets/);
});
