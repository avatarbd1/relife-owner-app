import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// Canonical production writers exercised by current API/domain boundaries.
// Historical modules chamberFixedHour.ts, appointmentScheduling.ts and financeOps.ts
// are intentionally excluded: current Chamber/appointment routes use capacityBooking,
// and the finance production boundary delegates to lib/domain/finance/* writers.
const PRODUCTION_WRITER_FILES = [
  "lib/webos/attendance.ts",
  "lib/webos/attendanceNormal.ts",
  "lib/webos/inventory.ts",
  "lib/webos/chamber.ts",
  "lib/webos/chamberAssignment.ts",
  "lib/webos/chamberClinicalNote.ts",
  "lib/webos/chamberComms.ts",
  "lib/webos/chamberPreference.ts",
  "lib/webos/generalTreatmentRuntime.ts",
  "lib/webos/appointmentStatus.ts",
  "lib/webos/corrections.ts",
  "lib/webos/ownCorrections.ts",
  "lib/domain/appointments/capacityBooking.ts",
] as const;

const HARDCODED_TENANT = /["'`]RELIFE(?:-PHYSIO|-DENTAL)?["'`]/g;

test("T3 Phase 4 canonical production writers contain no hardcoded Relife tenant identity", () => {
  const residue: string[] = [];

  for (const file of PRODUCTION_WRITER_FILES) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (HARDCODED_TENANT.test(lines[index])) {
        residue.push(`${file}:${index + 1}: ${lines[index].trim()}`);
      }
      HARDCODED_TENANT.lastIndex = 0;
    }
  }

  assert.deepEqual(residue, [], `Hardcoded tenant writer residue:\n${residue.join("\n")}`);
});
