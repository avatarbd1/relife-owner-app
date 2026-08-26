import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("instrumentation.ts", "utf8");

test("legacy media bulk migration cannot run on the app startup path", () => {
  assert.match(source, /if \(mode !== "physio-smoke"\) return;/);
  assert.doesNotMatch(source, /"all-bulk"/);
  assert.doesNotMatch(source, /runBulkDepartment/);
  assert.doesNotMatch(source, /MAX_BATCHES/);
  assert.match(source, /JSON\.stringify\(\{ department: "Physio", limit \}\)/);
  assert.match(source, /runMigrationBatch\(POST, key, 1\)/);
});
