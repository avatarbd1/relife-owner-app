import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../lib/patients.ts", import.meta.url),
  "utf8"
);

test("patient financial position reuses the shared patient cache", () => {
  assert.match(
    source,
    /const patients = patientsInScope\(await getPatients\(\), scope\)/
  );
  assert.doesNotMatch(
    source,
    /getPatientFinancialPosition[\s\S]*?patientsInScope\(await loadPatients\(\), scope\)/
  );
});
