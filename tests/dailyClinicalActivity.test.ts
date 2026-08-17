import test from "node:test";
import assert from "node:assert/strict";
import { calculateDailyClinicalActivity } from "../lib/domain/clinical/dailyActivity.ts";

const headers = [
  "Treatment_ID",
  "Date",
  "Patient_ID",
  "Department",
  "Session_No",
  "Plan_ID",
  "Encounter_ID",
  "Remarks",
];

const physio = [
  headers,
  ["TR1", "2026-08-17", "PT1", "Physio", "1", "PL1", "ENC1", ""],
  ["TR2", "2026-08-17", "PT1", "Physio", "1", "PL1", "ENC2", "duplicate legacy row"],
  ["TR3", "2026-08-17", "PT1", "Physio", "2", "PL1", "ENC3", ""],
  ["TR4", "2026-08-16", "PT1", "Physio", "3", "PL1", "ENC4", ""],
  ["TR5", "2026-08-17", "PT2", "Physio", "3", "PL2", "ENC-CHS1", "[CHAMBER_SESSION:CHS1]"],
  ["TR6", "2026-08-17", "PT2", "Physio", "3", "PL2", "ENC-CHS1", "[CHAMBER_SESSION:CHS1] duplicate"],
];

const dental = [
  headers,
  ["DT1", "2026-08-17", "DT1", "Dental", "", "", "DENC1", "Status: Planned"],
  ["DT2", "2026-08-17", "DT1", "Dental", "", "", "DENC2", "Status: Ongoing"],
  ["DT3", "2026-08-17", "DT2", "Dental", "", "", "DENC3", "Status: Completed"],
];

test("daily clinical activity counts delivered care, not duplicate or planned rows", () => {
  assert.deepEqual(
    calculateDailyClinicalActivity(physio, dental, "combined", "2026-08-17"),
    { patients: 4, sessions: 5, physioSessions: 3, dentalSessions: 2 }
  );
});

test("daily clinical activity respects department scope", () => {
  assert.deepEqual(
    calculateDailyClinicalActivity(physio, dental, "physio", "2026-08-17"),
    { patients: 2, sessions: 3, physioSessions: 3, dentalSessions: 0 }
  );
  assert.deepEqual(
    calculateDailyClinicalActivity(physio, dental, "dental", "2026-08-17"),
    { patients: 2, sessions: 2, physioSessions: 0, dentalSessions: 2 }
  );
});
