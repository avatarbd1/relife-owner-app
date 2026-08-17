import { describe, it } from "node:test";
import { ok, equal } from "node:assert";
import { readFileSync } from "node:fs";

const actionSource = readFileSync(
  new URL("../app/(dashboard)/reports/rangeReportsActions.ts", import.meta.url),
  "utf8"
);
const calculationsSource = readFileSync(
  new URL("../lib/calculations.ts", import.meta.url),
  "utf8"
);
const pickerSource = readFileSync(
  new URL("../components/DateRangePicker.tsx", import.meta.url),
  "utf8"
);

describe("A2 range reports architecture", () => {
  it("re-authorizes requested scope on the server", () => {
    ok(actionSource.includes("resolveAuthorizedScope(context, requestedScope)"));
    ok(actionSource.includes("assertValidDateRange(startDate, endDate)"));
  });

  it("does not use a hard-coded 30-day divisor for fixed-cost accrual", () => {
    equal(calculationsSource.includes("/ 30"), false);
    ok(calculationsSource.includes("segment.daysInMonth"));
    ok(calculationsSource.includes("fixedSalaryCommitment"));
  });

  it("keeps applied custom dates visible instead of falling back to month", () => {
    ok(pickerSource.includes("appliedCustom"));
    ok(pickerSource.includes('selectedRange === "custom"'));
  });
});
