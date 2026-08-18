import { describe, it } from "node:test";
import { deepEqual, equal, throws } from "node:assert";
import {
  assertValidDateRange,
  dateRangeMonthSegments,
  isValidIsoDate,
  prorateMonthlyAmount,
} from "../lib/domain/finance/dateRange.ts";

describe("Range reports date math", () => {
  it("accepts real ISO dates including leap day", () => {
    equal(isValidIsoDate("2024-02-29"), true);
    equal(isValidIsoDate("2026-08-18"), true);
  });

  it("rejects malformed, impossible, and reversed ranges", () => {
    equal(isValidIsoDate("2026-02-29"), false);
    equal(isValidIsoDate("18-08-2026"), false);
    throws(() => assertValidDateRange("2026-08-19", "2026-08-18"), /INVALID_DATE_RANGE/);
  });

  it("splits a cross-month range using the real number of calendar days", () => {
    const segments = dateRangeMonthSegments("2024-02-28", "2024-03-02");
    deepEqual(
      segments.map((segment) => ({
        month: segment.ref.getUTCMonth() + 1,
        days: segment.days,
        daysInMonth: segment.daysInMonth,
      })),
      [
        { month: 2, days: 2, daysInMonth: 29 },
        { month: 3, days: 2, daysInMonth: 31 },
      ]
    );
  });

  it("prorates monthly commitments by calendar-day share", () => {
    const segments = dateRangeMonthSegments("2026-08-01", "2026-08-07");
    equal(prorateMonthlyAmount(31_000, segments), 7_000);
  });
});
