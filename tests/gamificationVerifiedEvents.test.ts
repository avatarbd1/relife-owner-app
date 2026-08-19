import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = source(
  "supabase/migrations/20260819073125_gamification_v2_xp_rules.sql"
);
const edge = source("supabase/functions/relife-gamification-api/index.ts");
const events = source("lib/domain/gamification/events.ts");

test("XP earning rules are Owner-configured data rather than route constants", () => {
  assert.match(migration, /'xp\.rules'/);
  assert.match(migration, /"event_type":"session_completed"/);
  assert.match(migration, /"roles":\["Therapist","Dentist"\]/);
  assert.match(migration, /"event_type":"attendance_on_time"/);
  assert.match(migration, /"event_type":"patient_registered"[\s\S]*?"mode":"every_n","n":5/);
  assert.match(migration, /"event_type":"payment_processed"[\s\S]*?"mode":"every_n","n":10/);
  assert.match(migration, /"event_type":"appointment_booked"[\s\S]*?"mode":"every_n","n":5/);
  assert.match(migration, /partial progress carries forward/);
});

test("Edge owns XP calculation and serializes every-N threshold checks", () => {
  assert.match(edge, /activeXpRule/);
  assert.match(edge, /config_key = 'xp\.rules'/);
  assert.match(edge, /relife-xp-rule:/);
  assert.match(edge, /role_context = \$\{roleContext\}/);
  assert.match(edge, /event_type = \$\{eventType\}/);
  assert.match(edge, /eventCount % xpRule\.n === 0/);
  assert.match(edge, /xpAwarded = xpRule\.xp/);
  assert.match(edge, /v2:xp\.rules:/);
  assert.doesNotMatch(edge, /body\.xpAwarded/);
});

test("actor role attribution is purpose-aware and does not invent a role", () => {
  assert.match(events, /purpose === "reception"/);
  assert.match(events, /"Receptionist",[\s\S]*?"Manager",[\s\S]*?"Owner"/);
  assert.match(events, /primaryDepartment === "Dental" && has\("Dentist"\)/);
  assert.match(events, /primaryDepartment === "Physio" && has\("Therapist"\)/);
  assert.match(events, /reason: "actor_role_unresolved"/);
});

test("attendance creates verified on-time events only at the locked two-minute threshold", () => {
  const route = source("app/api/attendance/action/route.ts");

  assert.match(route, /action === "check_in"/);
  assert.match(route, /Number\(record\.lateMinutes \|\| 0\) <= 2/);
  assert.match(route, /"attendance_on_time"/);
  assert.match(route, /"attendance_check_in"/);
  assert.match(route, /eventKey: `attendance:\$\{record\.attendanceId\}:check_in:v2`/);
  assert.match(route, /verificationMethod: "canonical_attendance_check_in"/);
});

test("patient registration projects a deterministic verified Reception workflow event", () => {
  const route = source("app/api/patients/route.ts");

  assert.match(route, /registerPatientSerial/);
  assert.match(route, /eventType: "patient_registered"/);
  assert.match(route, /eventKey: `patient:\$\{department\}:\$\{result\.patientId\}:registered:v2`/);
  assert.match(route, /sourceType: "patient_registration"/);
  assert.match(route, /phonePresent/);
  assert.doesNotMatch(route, /xpAwarded/);
});

test("payment projects workflow count without copying the payment amount into Gamification payload", () => {
  const route = source("app/api/finance/payment/route.ts");

  assert.match(route, /await createPayment/);
  assert.match(route, /eventType: "payment_processed"/);
  assert.match(route, /eventKey: `payment:\$\{department\}:\$\{result\.receiptNo\}:processed:v2`/);
  assert.match(route, /sourceType: "finance_payment"/);
  const projection = route.slice(route.indexOf("recordActorWorkGamification"));
  assert.doesNotMatch(projection, /amount:/);
  assert.doesNotMatch(route, /xpAwarded/);
});

test("appointment creation projects a deterministic verified booking event", () => {
  const route = source("app/api/appointments/route.ts");

  assert.match(route, /createUnifiedPhysioBooking/);
  assert.match(route, /createAppointment/);
  assert.match(route, /eventType: "appointment_booked"/);
  assert.match(route, /eventKey: `appointment:\$\{patient\.department\}:\$\{result\.appointmentId\}:booked:v2`/);
  assert.match(route, /sourceType: "appointment_create"/);
  assert.doesNotMatch(route, /xpAwarded/);
});

test("all actor work projections are fail-soft after the canonical mutation", () => {
  assert.match(events, /Actor work Gamification projection failed/);
  assert.match(events, /reason: "write_failed"/);
  assert.match(events, /recordVerifiedGamificationEvent/);
});
