import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("generic and fixed-hour Physio booking both use ten-minute Manual Therapy", () => {
  const generic = source("lib/webos/appointmentScheduling.ts");
  const fixedHour = source("lib/webos/chamberFixedHour.ts");
  assert.match(
    generic,
    /value: "MANUAL",\s*label: "Manual Therapy",\s*durationMin: 10/
  );
  assert.match(
    fixedHour,
    /value: MANUAL_ID, label: "Manual Therapy", durationMin: 10/
  );
  assert.doesNotMatch(
    generic,
    /value: "MANUAL",\s*label: "Manual Therapy",\s*durationMin: 5/
  );
});
