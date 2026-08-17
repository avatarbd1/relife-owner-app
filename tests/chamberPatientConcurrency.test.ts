import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findActivePatientConflict } from "../lib/domain/chamber/patientConcurrency.ts";

test("same patient cannot have a second Waiting Chamber session", () => {
  const conflict = findActivePatientConflict(
    { appointmentId: "APPT-B", patientId: "PT-1" },
    [{ appointmentId: "APPT-A", patientId: "PT-1", status: "Waiting" }]
  );
  assert.equal(conflict?.appointmentId, "APPT-A");
});

test("same patient cannot have a second In Treatment Chamber session", () => {
  const conflict = findActivePatientConflict(
    { appointmentId: "APPT-B", patientId: "PT-1" },
    [{ appointmentId: "APPT-A", patientId: "PT-1", status: "In Treatment" }]
  );
  assert.equal(conflict?.appointmentId, "APPT-A");
});

test("same appointment remains idempotent rather than conflicting with itself", () => {
  const conflict = findActivePatientConflict(
    { appointmentId: "APPT-A", patientId: "PT-1" },
    [{ appointmentId: "APPT-A", patientId: "PT-1", status: "In Treatment" }]
  );
  assert.equal(conflict, null);
});

test("different patients can be active concurrently", () => {
  const conflict = findActivePatientConflict(
    { appointmentId: "APPT-B", patientId: "PT-2" },
    [{ appointmentId: "APPT-A", patientId: "PT-1", status: "In Treatment" }]
  );
  assert.equal(conflict, null);
});

test("Completed and Cancelled sessions do not block a later appointment", () => {
  const activity = [
    { appointmentId: "APPT-A", patientId: "PT-1", status: "Completed" },
    { appointmentId: "APPT-B", patientId: "PT-1", status: "Cancelled" },
  ];
  assert.equal(
    findActivePatientConflict({ appointmentId: "APPT-C", patientId: "PT-1" }, activity),
    null
  );
});

test("receive API serializes the active-patient check across appointments", () => {
  const route = readFileSync(
    new URL("../app/api/chamber/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /withMutationLock\("chamber-receive"/);
  assert.doesNotMatch(route, /chamber-receive:\$\{appointmentId/);
  assert.match(route, /findActivePatientConflict/);
  assert.match(route, /CHAMBER_PATIENT_ALREADY_ACTIVE/);
});
