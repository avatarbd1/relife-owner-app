import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("instrumentation.ts", "utf8");

test("legacy media startup bulk scope is Physio only", () => {
  assert.match(source, /await runBulkDepartment\(POST, key, "Physio"\);/);
  assert.doesNotMatch(source, /await runBulkDepartment\(POST, key, "Dental"\);/);
  assert.match(source, /Owner-approved legacy migration scope: Physio only/);
  assert.match(source, /Dental must not run/);
});
