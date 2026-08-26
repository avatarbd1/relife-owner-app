import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "app/api/internal/legacy-media-migration/route.ts",
  "utf8"
);
const boundary = readFileSync("lib/data/legacyReportStorage.ts", "utf8");

test("legacy media migration reuses the data-boundary report-storage roots", () => {
  assert.match(route, /legacyReportStorageRoot\(workbook\)/);
  assert.match(route, /@\/lib\/data\/legacyReportStorage/);
  assert.doesNotMatch(route, /RELIFE-PHYSIO|RELIFE-DENTAL/);
  assert.doesNotMatch(route, /safeSegment\(config\.clinicId, "clinic"\)/);
  assert.match(boundary, /RELIFE-PHYSIO/);
  assert.match(boundary, /RELIFE-DENTAL/);
  assert.match(boundary, /workbook === "dental"/);
});
