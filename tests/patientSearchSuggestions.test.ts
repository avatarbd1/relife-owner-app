import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeSearchDigits,
  searchPatients,
  type PatientSearchRecord,
} from "../lib/domain/patients/search.ts";

const patients: PatientSearchRecord[] = [
  {
    patientId: "PT-103",
    registrationDate: "2026-08-20",
    fullName: "Md Rahim Uddin",
    phone: "01712-345678",
    department: "Physio",
    diagnosis: "Low back pain",
    address: "Amtali Bazar",
    therapist: "Nipa",
    due: 500,
    status: "Active",
  },
  {
    patientId: "DT-103",
    registrationDate: "2026-08-21",
    fullName: "Rahima Begum",
    phone: "01899 111222",
    department: "Dental",
    diagnosis: "Dental filling",
    address: "Patuakhali",
    therapist: "Hasibur",
    due: 0,
    status: "Active",
  },
];

test("search accepts Bangla digits for existing English-digit IDs", () => {
  assert.equal(normalizeSearchDigits("১০৩"), "103");
  const results = searchPatients(patients, { query: "PT ১০৩" });
  assert.equal(results[0]?.patient.patientId, "PT-103");
  assert.equal(results[0]?.matchedBy, "ID");
});

test("exact name token ranks before a longer prefix", () => {
  const results = searchPatients(patients, { query: "Rahim" });
  assert.equal(results[0]?.patient.patientId, "PT-103");
});

test("phone punctuation does not prevent a match", () => {
  const results = searchPatients(patients, { query: "০১৭১২৩৪৫৬৭৮" });
  assert.equal(results[0]?.patient.patientId, "PT-103");
  assert.equal(results[0]?.matchedBy, "Phone");
});

test("department filter is applied before suggestions", () => {
  const results = searchPatients(patients, { query: "103", department: "Dental" });
  assert.deepEqual(results.map((item) => item.patient.patientId), ["DT-103"]);
});

test("PatientsClient keeps lightweight Select patient suggestions and existing workflows", () => {
  const client = readFileSync(
    new URL("../components/PatientsClient.tsx", import.meta.url),
    "utf8"
  );

  assert.match(client, /Select patient/);
  assert.match(client, /matches\.slice\(0, 5\)/);
  assert.match(client, /suggestion-\$\{patient\.department\}-\$\{patient\.patientId\}/);
  assert.match(client, /View file/);
  assert.match(client, /Payment/);
  assert.match(client, /Appointment/);
  assert.match(client, /filters\.map/);
  assert.doesNotMatch(client, /Recent patients/);
  assert.doesNotMatch(client, /Any status/);
});
