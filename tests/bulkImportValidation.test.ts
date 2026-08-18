import { describe, it } from "node:test";
import { ok, equal } from "node:assert";

// Test data validation logic similar to bulk import route
interface ImportRow {
  fullName: string;
  department: "Physio" | "Dental";
  phone?: string;
  email?: string;
  age?: number;
  gender?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validatePatientRow(row: any, rowNumber: number): ValidationResult {
  const errors: string[] = [];

  // Check required fields
  const fullName = String(row.fullName || "").trim();
  if (!fullName) {
    errors.push("Missing patient name");
  }

  const department = String(row.department || "").trim();
  if (!["Physio", "Dental"].includes(department)) {
    errors.push("Invalid department. Use 'Physio' or 'Dental'");
  }

  // Validate optional fields
  if (row.age) {
    const age = parseInt(String(row.age), 10);
    if (isNaN(age) || age < 0 || age > 150) {
      errors.push("Age must be a valid number between 0 and 150");
    }
  }

  if (row.email) {
    const email = String(row.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Invalid email format");
    }
  }

  if (row.phone) {
    const phone = String(row.phone || "").trim();
    if (phone && !/^[+\d\s\-()]+$/.test(phone)) {
      errors.push("Invalid phone format");
    }
  }

  if (row.gender) {
    const gender = String(row.gender || "").trim();
    if (!["Male", "Female"].includes(gender)) {
      errors.push("Gender must be 'Male' or 'Female'");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

describe("Patient Bulk Import Validation", () => {
  describe("Required field validation", () => {
    it("validates row with required fields", () => {
      const row = {
        fullName: "Ahmed Khan",
        department: "Physio",
      };

      const result = validatePatientRow(row, 1);

      equal(result.valid, true, "valid row passes");
      equal(result.errors.length, 0, "no errors for valid row");
    });

    it("rejects row missing name", () => {
      const row = {
        fullName: "",
        department: "Physio",
      };

      const result = validatePatientRow(row, 1);

      equal(result.valid, false, "invalid without name");
      ok(
        result.errors.some((e) => e.includes("patient name")),
        "error mentions missing name"
      );
    });

    it("rejects row with invalid department", () => {
      const row = {
        fullName: "Ahmed Khan",
        department: "Surgery",
      };

      const result = validatePatientRow(row, 1);

      equal(result.valid, false, "invalid department rejected");
      ok(
        result.errors.some((e) => e.includes("Invalid department")),
        "error mentions invalid department"
      );
    });

    it("accepts either Physio or Dental department", () => {
      const physio = validatePatientRow(
        { fullName: "Ahmed", department: "Physio" },
        1
      );
      const dental = validatePatientRow(
        { fullName: "Fatima", department: "Dental" },
        1
      );

      equal(physio.valid, true, "Physio department valid");
      equal(dental.valid, true, "Dental department valid");
    });
  });

  describe("Optional field validation", () => {
    it("validates age field", () => {
      const validAge = validatePatientRow(
        { fullName: "Ahmed", department: "Physio", age: 35 },
        1
      );
      const invalidAge = validatePatientRow(
        { fullName: "Ahmed", department: "Physio", age: 200 },
        1
      );

      equal(validAge.valid, true, "valid age accepted");
      equal(invalidAge.valid, false, "invalid age rejected");
    });

    it("validates email format", () => {
      const validEmail = validatePatientRow(
        {
          fullName: "Ahmed",
          department: "Physio",
          email: "ahmed@example.com",
        },
        1
      );
      const invalidEmail = validatePatientRow(
        {
          fullName: "Ahmed",
          department: "Physio",
          email: "not-an-email",
        },
        1
      );

      equal(validEmail.valid, true, "valid email accepted");
      equal(invalidEmail.valid, false, "invalid email rejected");
    });

    it("validates phone format", () => {
      const validPhone = validatePatientRow(
        {
          fullName: "Ahmed",
          department: "Physio",
          phone: "+880123456789",
        },
        1
      );
      const anotherFormat = validatePatientRow(
        {
          fullName: "Ahmed",
          department: "Physio",
          phone: "01700-000-001",
        },
        1
      );

      equal(validPhone.valid, true, "phone with + accepted");
      equal(anotherFormat.valid, true, "phone with dashes accepted");
    });

    it("validates gender field", () => {
      const validGender = validatePatientRow(
        {
          fullName: "Ahmed",
          department: "Physio",
          gender: "Male",
        },
        1
      );
      const invalidGender = validatePatientRow(
        {
          fullName: "Ahmed",
          department: "Physio",
          gender: "Other",
        },
        1
      );

      equal(validGender.valid, true, "valid gender accepted");
      equal(invalidGender.valid, false, "invalid gender rejected");
    });
  });

  describe("Multiple field validation", () => {
    it("validates complete patient record", () => {
      const row = {
        fullName: "Ahmed Khan",
        department: "Physio",
        phone: "+880123456789",
        email: "ahmed@example.com",
        age: 45,
        gender: "Male",
        address: "123 Street, Dhaka",
      };

      const result = validatePatientRow(row, 1);

      equal(result.valid, true, "complete record valid");
    });

    it("reports multiple errors in one row", () => {
      const row = {
        fullName: "",
        department: "Invalid",
        age: 200,
        email: "bad-email",
      };

      const result = validatePatientRow(row, 1);

      equal(result.valid, false, "row with multiple errors invalid");
      ok(result.errors.length > 1, "reports multiple errors");
    });
  });

  describe("Field trimming and normalization", () => {
    it("handles whitespace in fields", () => {
      const row = {
        fullName: "  Ahmed Khan  ",
        department: "  Physio  ",
      };

      const result = validatePatientRow(row, 1);

      equal(result.valid, true, "whitespace trimmed before validation");
    });

    it("accepts case-sensitive department values", () => {
      const lowercase = validatePatientRow(
        { fullName: "Ahmed", department: "physio" as any },
        1
      );
      // The actual implementation checks for exact case, so this should fail
      equal(lowercase.valid, false, "case-sensitive department check enforced");
    });
  });
});
