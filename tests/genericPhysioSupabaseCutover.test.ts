import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("generic Physio appointment routes keep legacy validation semantics behind the cutover domain", () => {
  const route = source("app/api/appointments/route.ts");
  const validateRoute = source("app/api/appointments/validate/route.ts");
  const command = source("lib/domain/appointments/create.ts");

  assert.match(route, /createUnifiedPhysioBooking/);
  assert.match(validateRoute, /validateUnifiedPhysioBooking/);
  assert.match(command, /validatePhysioBooking/);
  assert.match(command, /createPhysioBooking/);
  assert.match(command, /chamberDbMode\(\) !== "supabase"/);
  assert.match(command, /SUPABASE_EDGE_SECRET_MISSING/);
  assert.match(command, /totalDurationMin: validation\.totalDurationMin/);
  assert.match(command, /startMinute: timeMinutes\(input\.time\)/);
  assert.doesNotMatch(command, /startMinute\s*%\s*60/);
});

test("generic Physio create uses stable per-slot browser request IDs and a tenant/date transaction lock", () => {
  const form = source("components/AppointmentFormMultiDate.tsx");
  const command = source("lib/domain/appointments/create.ts");
  const edge = source("supabase/functions/relife-appointment-api/index.ts");

  assert.match(form, /const requestIdsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(form, /function requestIdFor\(slot: BookingSlot\)/);
  assert.match(form, /window\.crypto\.randomUUID/);
  assert.match(form, /requestId: selectedPatient\.department === "Physio" \? requestId : undefined/);
  assert.match(command, /INVALID_REQUEST_ID/);
  assert.match(command, /createSupabaseValidatedBooking/);

  assert.match(edge, /request_id=\$\{requestId\}/);
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /relife-appointment:\$\{tenant\.clinicId\}:\$\{plan\.date\}/);
  assert.match(edge, /clinic_id=\$\{tenant\.clinicId\}::uuid/);
  assert.match(edge, /expected_duration_min/);
  assert.match(edge, /machine_reservations/);
  assert.doesNotMatch(edge, /therapist_busy/);
});

test("generic appointment transaction writes audit atomically and does not activate production mode", () => {
  const edge = source("supabase/functions/relife-appointment-api/index.ts");
  const migration = source(
    "supabase/migrations/20260816173500_appointment_transaction_audit.sql"
  );
  const data = source("lib/data/supabaseChamber.ts");

  assert.match(edge, /insert into relife\.audit_events/);
  assert.match(edge, /'APPOINTMENT_CREATED'/);
  assert.match(migration, /create table if not exists relife\.audit_events/);
  assert.match(migration, /unique \(clinic_id, request_id, action\)/);
  assert.match(migration, /enable row level security/);
  assert.match(data, /relife-appointment-api/);
  assert.match(data, /RELIFE_CHAMBER_DB_MODE \|\| "sheets"/);
});

test("fixed-hour cutover also requires an explicit stable request ID", () => {
  const scheduler = source("lib/domain/chamber/scheduler.ts");
  const handler = source("app/api/chamber/schedule/handler.ts");

  assert.match(scheduler, /FixedHourInput & \{ requestId\?: string \}/);
  assert.match(scheduler, /stableRequestId\(input\.requestId\)/);
  assert.match(scheduler, /if \(!chamberSupabaseConfigured\(\)\) throw new Error\("SUPABASE_EDGE_SECRET_MISSING"\)/);
  assert.match(handler, /requestId: String\(body\.requestId \|\| ""\)/);
});
