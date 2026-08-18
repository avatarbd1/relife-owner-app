import { describe, it } from "node:test";
import { equal } from "node:assert";

// CSV escaping logic from export route
function escapeCSV(value: unknown): string {
  const str = String(value ?? "").trim();
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows: any[][], headers?: string[]): string {
  if (rows.length === 0) return "";

  if (!headers) {
    headers = Object.keys(rows[0]);
  }

  const lines: string[] = [headers.map(escapeCSV).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCSV(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

describe("CSV Export Escaping and Formatting", () => {
  describe("escapeCSV", () => {
    it("leaves simple strings unchanged", () => {
      equal(escapeCSV("Ahmed"), "Ahmed", "simple string unchanged");
      equal(escapeCSV("12345"), "12345", "number string unchanged");
    });

    it("escapes strings with commas", () => {
      const result = escapeCSV("Khan, Ahmed");
      equal(result, '"Khan, Ahmed"', "quoted when comma present");
    });

    it("escapes strings with quotes", () => {
      const result = escapeCSV('Ahmed "Khan" Khan');
      equal(result, '"Ahmed ""Khan"" Khan"', "quotes doubled inside quoted string");
    });

    it("escapes strings with newlines", () => {
      const result = escapeCSV("line 1\nline 2");
      equal(result, '"line 1\nline 2"', "quoted when newline present");
    });

    it("handles multiple special characters", () => {
      const result = escapeCSV('Ahmed "Khan", note');
      equal(result, '"Ahmed ""Khan"", note"', "quotes escaped and comma causes quoting");
    });

    it("trims whitespace before escaping", () => {
      equal(escapeCSV("  Ahmed  "), "Ahmed", "whitespace trimmed");
      equal(escapeCSV("  Ahmed, Khan  "), '"Ahmed, Khan"', "trimmed then escaped");
    });

    it("handles null/undefined values", () => {
      equal(escapeCSV(null), "", "null becomes empty string");
      equal(escapeCSV(undefined), "", "undefined becomes empty string");
    });

    it("handles numeric values", () => {
      equal(escapeCSV(1000), "1000", "number as string");
      equal(escapeCSV(99.99), "99.99", "decimal as string");
    });
  });

  describe("toCSV", () => {
    it("generates simple CSV with headers", () => {
      const rows = [{ name: "Ahmed", age: 30 }];
      const result = toCSV(rows);

      const lines = result.split("\n");
      equal(lines.length, 2, "header and one data row");
      equal(lines[0], "name,age", "headers correct");
      equal(lines[1], "Ahmed,30", "data row correct");
    });

    it("generates CSV with multiple rows", () => {
      const rows = [
        { name: "Ahmed", age: 30 },
        { name: "Fatima", age: 28 },
      ];
      const result = toCSV(rows);

      const lines = result.split("\n");
      equal(lines.length, 3, "header plus two data rows");
      equal(lines[1], "Ahmed,30", "first data row");
      equal(lines[2], "Fatima,28", "second data row");
    });

    it("uses provided headers if specified", () => {
      const rows = [{ name: "Ahmed", age: 30, city: "Dhaka" }];
      const headers = ["name", "age"];
      const result = toCSV(rows, headers);

      const lines = result.split("\n");
      equal(lines[0], "name,age", "uses provided headers");
      equal(lines[1], "Ahmed,30", "only specified columns included");
    });

    it("handles missing columns in data rows", () => {
      const rows = [
        { name: "Ahmed", age: 30 },
        { name: "Fatima" }, // missing age
      ];
      const result = toCSV(rows);

      const lines = result.split("\n");
      equal(lines[2], "Fatima,", "missing value becomes empty");
    });

    it("escapes special characters in CSV output", () => {
      const rows = [{ description: "Treatment, notes: initial assessment" }];
      const result = toCSV(rows);

      const lines = result.split("\n");
      equal(
        lines[1],
        '"Treatment, notes: initial assessment"',
        "description with comma is quoted"
      );
    });

    it("handles empty rows array", () => {
      const result = toCSV([]);
      equal(result, "", "empty array returns empty string");
    });

    it("generates valid payment export", () => {
      const payments = [
        {
          receiptNo: "REC-001",
          date: "2024-06-15",
          amount: 5000,
          patientName: "Khan, Ahmed",
          remarks: "Initial treatment",
        },
        {
          receiptNo: "REC-002",
          date: "2024-06-16",
          amount: 3500,
          patientName: "Begum, Fatima",
          remarks: "Follow-up",
        },
      ];

      const result = toCSV(payments);
      const lines = result.split("\n");

      equal(lines.length, 3, "header and two payment rows");
      equal(lines[0], "receiptNo,date,amount,patientName,remarks");
      equal(lines[1], '"REC-001","2024-06-15","5000","Khan, Ahmed","Initial treatment"');
      equal(lines[2], '"REC-002","2024-06-16","3500","Begum, Fatima","Follow-up"');
    });

    it("handles complex nested quote scenarios", () => {
      const rows = [
        {
          name: 'Patient name: "Mr Khan"',
          notes: 'Doctor said: "continue treatment"',
        },
      ];

      const result = toCSV(rows);
      const lines = result.split("\n");

      // Both columns have quotes, so both should be escaped
      equal(
        lines[1],
        '"Patient name: ""Mr Khan""","Doctor said: ""continue treatment"""'
      );
    });
  });

  describe("Real-world scenarios", () => {
    it("exports patient registry correctly", () => {
      const patients = [
        {
          patientId: "P001",
          fullName: "Ahmed Khan",
          phone: "01700000001",
          department: "Physio",
          status: "Active",
        },
        {
          patientId: "P002",
          fullName: "Fatima, Dr.",
          phone: "01712345678",
          department: "Dental",
          status: "Active",
        },
      ];

      const result = toCSV(patients);
      const lines = result.split("\n");

      equal(lines.length, 3, "header plus patient rows");
      equal(
        lines[2],
        '"P002","Fatima, Dr.","01712345678","Dental","Active"'
      );
    });

    it("exports appointment data with notes containing special characters", () => {
      const appointments = [
        {
          appointmentId: "APT-001",
          date: "2024-06-15",
          time: "10:00",
          patientName: "Ahmed Khan",
          remarks: "Treatment: initial assessment, requires follow-up",
        },
      ];

      const result = toCSV(appointments);
      const lines = result.split("\n");

      equal(lines.length, 2, "header and appointment");
      ok(
        lines[1].includes('"Treatment: initial assessment, requires follow-up"'),
        "remarks properly escaped"
      );
    });
  });
});
