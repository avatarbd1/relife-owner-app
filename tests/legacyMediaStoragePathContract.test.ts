import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "app/api/internal/legacy-media-migration/route.ts",
  "utf8"
);

test("legacy media migration uses report-storage legacy department roots", () => {
  assert.match(source, /RELIFE-PHYSIO/);
  assert.match(source, /RELIFE-DENTAL/);
  assert.match(source, /storageRootFor\(department\)/);
  assert.match(source, /department === "Dental" \? "RELIFE-DENTAL" : "RELIFE-PHYSIO"/);
  assert.doesNotMatch(source, /safeSegment\(config\.clinicId, "clinic"\)/);
});
