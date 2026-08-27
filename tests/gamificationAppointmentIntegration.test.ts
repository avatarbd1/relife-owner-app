import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("appointment completion is the mutation trigger for session XP", () => {
  const status = source("lib/webos/appointmentStatus.ts");

  assert.match(status, /recordAppointmentCompletionGamification/);
  assert.match(status, /if \(status === "Completed"\)/);
  assert.match(status, /therapistReference: at\(row, therapistIdx\)/);
  assert.match(status, /patientId: at\(row, patientIdx\)/);
  assert.match(status, /previousStatus: previous/);
  assert.doesNotMatch(status, /xpAwarded/);
});

test("repeated Completed status is an idempotent repair opportunity", () => {
  const status = source("lib/webos/appointmentStatus.ts");

  assert.match(status, /if \(normalized\(previous\) === normalized\(status\)\)/);
  assert.match(status, /if \(status === "Completed"\) \{[\s\S]*?projectCompletedAppointment/);
});

test("session XP belongs to the assigned clinician, not the mutation actor", () => {
  const events = source("lib/domain/gamification/events.ts");

  assert.match(events, /resolveAppointmentClinician/);
  assert.match(events, /normalize\(identity\.staffId\) === reference/);
  assert.match(events, /normalize\(identity\.fullName\) === reference/);
  assert.match(events, /byName\.length === 1 \? byName\[0\] : null/);
  assert.match(events, /staffId: clinician\.staffId/);
  assert.match(events, /actorId: input\.actorContext\.staffId/);
  assert.doesNotMatch(events, /staffId: input\.actorContext\.staffId/);
});

test("completed appointment event is deterministic but XP amount is server-owned", () => {
  const events = source("lib/domain/gamification/events.ts");
  const edge = source("supabase/functions/relife-gamification-api/index.ts");

  assert.match(events, /eventType: "session_completed"/);
  assert.match(events, /eventKey: `appointment:\$\{input\.department\}:\$\{input\.appointmentId\}:completed:v2`/);
  assert.match(events, /sourceType: "appointment_status"/);
  assert.match(events, /sourceId: input\.appointmentId/);
  assert.match(events, /metricValue: 1/);
  assert.doesNotMatch(events, /xpAwarded: 1/);
  assert.match(events, /verificationMethod: "canonical_appointment_transition"/);
  assert.match(edge, /activeXpRule/);
  assert.match(edge, /config_key = 'xp\.rules'/);
  assert.match(edge, /xpAwarded = xpRule\.xp/);
});

test("gamification projection never guesses a clinician or rewrites canonical mutation", () => {
  const events = source("lib/domain/gamification/events.ts");
  const status = source("lib/webos/appointmentStatus.ts");

  assert.match(events, /reason: "clinician_unresolved"/);
  assert.match(events, /reason: "write_failed"/);
  assert.match(status, /Appointment completed without Gamification v2 projection/);
  assert.match(status, /await Promise\.all\(updates\);[\s\S]*?if \(status === "Completed"\)/);
});
