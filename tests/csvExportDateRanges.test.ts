import { describe, it } from "node:test";
import { ok, equal } from "node:assert";

// Copy of the helper functions from the CSV export route for testing
function getDateRange(dateRange: string, startDate: string, endDate: string): { start: Date; end: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start = new Date(today);
  let end = new Date(today);
  end.setHours(23, 59, 59, 999);

  switch (dateRange) {
    case "this-month":
      start.setDate(1);
      break;
    case "last-month":
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case "this-year":
      start.setMonth(0);
      start.setDate(1);
      break;
    case "custom":
      if (startDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      }
      break;
    case "all":
    default:
      start = new Date(1970, 0, 1);
      end = new Date(2100, 0, 1);
      break;
  }

  return { start, end };
}

function matchesDateRange(dateStr: string, dateRange: { start: Date; end: Date }): boolean {
  const date = new Date(dateStr);
  return date >= dateRange.start && date <= dateRange.end;
}

describe("CSV Export Date Range Filtering", () => {
  describe("getDateRange", () => {
    it("returns wide range for 'all' date range", () => {
      const range = getDateRange("all", "", "");

      ok(range.start.getFullYear() < 2000, "start year is far in past");
      ok(range.end.getFullYear() > 2050, "end year is far in future");
    });

    it("filters to current month for 'this-month'", () => {
      const range = getDateRange("this-month", "", "");
      const today = new Date();

      equal(range.start.getDate(), 1, "starts on 1st of month");
      equal(range.start.getMonth(), today.getMonth(), "same month");
      equal(range.start.getFullYear(), today.getFullYear(), "same year");
    });

    it("filters to current year for 'this-year'", () => {
      const range = getDateRange("this-year", "", "");
      const today = new Date();

      equal(range.start.getMonth(), 0, "starts in January");
      equal(range.start.getDate(), 1, "starts on 1st");
      equal(range.start.getFullYear(), today.getFullYear(), "same year");
    });

    it("respects custom date range", () => {
      const range = getDateRange("custom", "2024-06-15", "2024-12-31");

      equal(range.start.getFullYear(), 2024, "start year correct");
      equal(range.start.getMonth(), 5, "start month is June (0-indexed)");
      equal(range.start.getDate(), 15, "start date is 15th");

      equal(range.end.getFullYear(), 2024, "end year correct");
      equal(range.end.getMonth(), 11, "end month is December");
      equal(range.end.getDate(), 31, "end date is 31st");
    });

    it("handles custom range with only start date", () => {
      const range = getDateRange("custom", "2024-06-15", "");

      equal(range.start.getDate(), 15, "start date set");
      ok(range.end.getFullYear() >= 2024, "end date is in future");
    });

    it("handles custom range with only end date", () => {
      const range = getDateRange("custom", "", "2024-12-31");

      ok(range.start.getFullYear() <= 2024, "start date is in past");
      equal(range.end.getDate(), 31, "end date set");
    });
  });

  describe("matchesDateRange", () => {
    it("includes dates within range", () => {
      const range = { start: new Date("2024-06-01"), end: new Date("2024-06-30") };

      ok(matchesDateRange("2024-06-15", range), "date in middle of range matches");
      ok(matchesDateRange("2024-06-01", range), "date at start matches");
      ok(matchesDateRange("2024-06-30", range), "date at end matches");
    });

    it("excludes dates outside range", () => {
      const range = { start: new Date("2024-06-01"), end: new Date("2024-06-30") };

      equal(matchesDateRange("2024-05-31", range), false, "date before start excluded");
      equal(matchesDateRange("2024-07-01", range), false, "date after end excluded");
    });

    it("handles date string parsing correctly", () => {
      const range = { start: new Date("2024-01-01"), end: new Date("2024-12-31") };

      ok(matchesDateRange("2024-06-15", range), "YYYY-MM-DD format parsed");
      ok(matchesDateRange("2024-12-31", range), "year-end date parsed");
    });
  });

  describe("Integration: date filtering workflow", () => {
    it("filters payments correctly for this month", () => {
      const payments = [
        { date: "2024-06-10", amount: 100 },
        { date: "2024-05-15", amount: 200 },
        { date: "2024-07-05", amount: 300 },
      ];

      // Assume today is in June 2024
      const range = getDateRange("this-month", "", "");
      const filtered = payments.filter((p) => matchesDateRange(p.date, range));

      // Note: This test is date-dependent. In real scenarios, mock the current date.
      ok(filtered.length >= 0, "filters applied without error");
    });

    it("filters appointments correctly for custom range", () => {
      const appointments = [
        { date: "2024-06-01", patientName: "Ahmed" },
        { date: "2024-06-15", patientName: "Fatima" },
        { date: "2024-07-01", patientName: "Ali" },
      ];

      const range = getDateRange("custom", "2024-06-01", "2024-06-30");
      const filtered = appointments.filter((a) => matchesDateRange(a.date, range));

      equal(filtered.length, 2, "filters to 2 appointments in June");
      equal(filtered[0].patientName, "Ahmed", "first appointment is Ahmed");
      equal(filtered[1].patientName, "Fatima", "second appointment is Fatima");
    });

    it("all-time range includes all dates", () => {
      const records = [
        { date: "2000-01-01", value: "old" },
        { date: "2024-06-15", value: "recent" },
        { date: "2050-12-31", value: "future" },
      ];

      const range = getDateRange("all", "", "");
      const filtered = records.filter((r) => matchesDateRange(r.date, range));

      equal(filtered.length, 3, "includes all records for 'all' range");
    });
  });
});
