import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const WRITER_FILES = [
  "lib/webos/chamberAssignment.ts",
  "lib/webos/chamberClinicalNote.ts",
  "lib/webos/chamberFixedHour.ts",
  "lib/webos/appointmentScheduling.ts",
  "lib/webos/corrections.ts",
  "lib/webos/generalTreatmentRuntime.ts",
  "lib/webos/financeOps.ts",
  "lib/webos/ownCorrections.ts",
] as const;

const HARDCODED_TENANT = /["'`]RELIFE(?:-PHYSIO|-DENTAL)?["'`]/g;

test("T3 Phase 4 writer modules contain no hardcoded Relife tenant identity", () => {
  const residue: string[] = [];

  for (const file of WRITER_FILES) {
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
