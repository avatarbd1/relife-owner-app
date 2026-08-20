import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSearchDigits,
  normalizeSearchText,
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
  {
    patientId: "PT-220",
    registrationDate: "2026-08-18",
    fullName: "Abdul Karim",
    phone: "01900123456",
    department: "Physio",
    diagnosis: "Frozen shoulder",
    address: "Kalapara",
    therapist: "Nipa",
    due: 1200,
    status: "Inactive",
  },
];

test("normalizes Bangla digits and punctuation safely", () => {
  assert.equal(normalizeSearchDigits("০১৭১২-৩৪৫৬৭৮"), "01712-345678");
  assert.equal(normalizeSearchText(" PT—১০৩ "), "pt 103");
});

test("Bangla numeric patient ID search finds the same English-digit ID", () => {
  const results = searchPatients(patients, { query: "PT ১০৩" });
  assert.equal(results[0]?.patient.patientId, "PT-103");
  assert.equal(results[0]?.matchedBy, "ID");
  assert.equal(results[0]?.score, 1000);
});

test("formatted phone search ignores spaces and punctuation", () => {
  const results = searchPatients(patients, { query: "০১৭১২৩৪৫৬৭৮" });
  assert.equal(results[0]?.patient.patientId, "PT-103");
  assert.equal(results[0]?.matchedBy, "Phone");
});

test("exact ID ranks above newer partial-name matches", () => {
  const results = searchPatients(patients, { query: "PT-103", sort: "recent" });
  assert.equal(results[0]?.patient.patientId, "PT-103");
  assert.ok(results[0].score > (results[1]?.score || 0));
});

test("multi-word name search works regardless of extra spaces", () => {
  const results = searchPatients(patients, { query: "  rahim   uddin " });
  assert.equal(results[0]?.patient.patientId, "PT-103");
  assert.equal(results[0]?.matchedBy, "Name");
});

test("department and status filters apply before ranking", () => {
  const dental = searchPatients(patients, { query: "103", department: "Dental" });
  assert.deepEqual(dental.map((item) => item.patient.patientId), ["DT-103"]);

  const inactive = searchPatients(patients, { status: "Inactive", sort: "due" });
  assert.deepEqual(inactive.map((item) => item.patient.patientId), ["PT-220"]);
});

test("does not fuzzy-match unrelated patient text", () => {
  const results = searchPatients(patients, { query: "Rohim" });
  assert.equal(results.length, 0);
});

test("empty query returns every permitted row and respects selected sort", () => {
  const results = searchPatients(patients, { sort: "due" });
  assert.equal(results.length, patients.length);
  assert.deepEqual(results.map((item) => item.patient.patientId), ["PT-220", "PT-103", "DT-103"]);
});
