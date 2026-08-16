import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("appointment workspace and patient history use the cutover read model", () => {
  const workspace = source("app/(dashboard)/appointments/page.tsx");
  const patient = source("app/(dashboard)/patients/[patientId]/page.tsx");
  const readModel = source("lib/domain/appointments/read.ts");

  assert.match(workspace, /getUnifiedAppointmentsForContext/);
  assert.match(workspace, /monthKey}-01/);
  assert.match(patient, /getUnifiedPatientAppointmentsForContext/);
  assert.match(readModel, /chamberDbMode\(\) === "supabase"/);
  assert.match(readModel, /querySupabaseChamberAppointments/);
  assert.match(readModel, /merged\.set\(`Physio:/);
  assert.doesNotMatch(readModel, /catch\s*\([^)]*\)\s*\{[^}]*return sheetRows/s);
});

test("appointment status keeps legacy Sheets writer and falls through to Supabase only for cutover Physio rows", () => {
  const route = source("app/api/appointments/status/route.ts");
  const command = source("lib/domain/appointments/status.ts");
  const edge = source("supabase/functions/relife-chamber-api/index.ts");
  const migration = source(
    "supabase/migrations/20260816170000_appointment_status_actor.sql"
  );

  assert.match(route, /updateUnifiedAppointmentStatus/);
  assert.match(command, /updateAppointmentStatus/);
  assert.match(command, /message !== "APPOINTMENT_NOT_FOUND"/);
  assert.match(command, /department !== "Physio"/);
  assert.match(command, /chamberDbMode\(\) !== "supabase"/);
  assert.match(command, /updateSupabaseChamberAppointmentStatus/);

  assert.match(edge, /action === "appointments_query"/);
  assert.match(edge, /APPOINTMENT_FILTER_REQUIRED/);
  assert.match(edge, /DATE_RANGE_TOO_LARGE/);
  assert.match(edge, /action === "update_booking_status"/);
  assert.match(edge, /clinic_id=\$\{tenant\.clinicId\}::uuid/);
  assert.match(edge, /updated_by=\$\{actorId\}/);
  assert.match(migration, /add column if not exists updated_by text/);
});
