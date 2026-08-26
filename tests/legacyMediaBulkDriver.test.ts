import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("instrumentation.ts", "utf8");

test("legacy media bulk driver stays bounded and fail-closed", () => {
  assert.match(source, /mode !== "physio-smoke" && mode !== "all-bulk"/);
  assert.match(source, /const MAX_BATCHES = 100/);
  assert.match(source, /department,\n      10/);
  assert.match(source, /if \(!response\.ok \|\| failed > 0\)/);
  assert.match(source, /if \(migrated === 0\)/);
  assert.match(source, /await runBulkDepartment\(POST, key, "Physio"\)/);
  assert.match(source, /await runBulkDepartment\(POST, key, "Dental"\)/);
});
