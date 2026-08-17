import test from "node:test";
import assert from "node:assert/strict";
import { buildChamberClinicalFields } from "../lib/domain/chamber/clinicalNote.ts";

test("Chamber treatment steps become ordered clinical note fields", () => {
  const result = buildChamberClinicalFields([
    {
      step: "Wax",
      resourceId: "WAX-01",
      startedAt: "2026-08-17T04:00:00.000Z",
      endedAt: "2026-08-17T04:10:00.000Z",
      plannedDurationMin: 10,
    },
    {
      step: "Manual Therapy",
      resourceId: "",
      startedAt: "2026-08-17T04:10:00.000Z",
      endedAt: "2026-08-17T04:20:00.000Z",
      plannedDurationMin: 10,
    },
    {
      step: "TENS",
      resourceId: "TENS-01",
      plannedDurationMin: 20,
    },
  ]);

  assert.equal(
    result.treatmentGiven,
    "1. Wax (10 min) → 2. Manual Therapy (10 min) → 3. TENS (20 min)"
  );
  assert.equal(result.electrotherapy, "Wax (10 min); TENS (20 min)");
  assert.equal(result.manualTherapy, "Manual Therapy (10 min)");
  assert.equal(result.stepCount, 3);
});

test("Chamber note ignores the runtime start marker", () => {
  const result = buildChamberClinicalFields([
    { step: "Treatment started" },
    { step: "Manual Therapy", plannedDurationMin: 10 },
  ]);

  assert.equal(result.treatmentGiven, "1. Manual Therapy (10 min)");
  assert.equal(result.manualTherapy, "Manual Therapy (10 min)");
  assert.equal(result.stepCount, 1);
});
