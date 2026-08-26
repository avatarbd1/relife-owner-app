import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("instrumentation.ts", "utf8");

test("legacy media startup diagnostic remains Physio only", () => {
  assert.match(source, /department: "Physio"/);
  assert.match(source, /mode !== "physio-smoke"/);
  assert.doesNotMatch(source, /department: "Dental"/);
  assert.doesNotMatch(source, /runBulkDepartment/);
});
