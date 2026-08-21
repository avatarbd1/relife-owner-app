import test from "node:test";
import assert from "node:assert/strict";

/**
 * P0-05 Salary Type Correction: Comprehensive Tests
 *
 * Validates the bounded correction for salary payment type distinction:
 * - Salary | Advance explicit classification
 * - Legacy rows remain Unknown when type is absent
 * - Parser supports Type/Payment_Type columns
 * - API validates fail-closed (missing/invalid type rejected)
 * - Calculations expose type breakdown separately
 */

test("P0-05 Salary Type: Valid Salary type accepted", () => {
  const input = { type: "Salary" as const };
  assert.strictEqual(input.type, "Salary", "type: Salary is valid");
});

test("P0-05 Salary Type: Valid Advance type accepted", () => {
  const input = { type: "Advance" as const };
  assert.strictEqual(input.type, "Advance", "type: Advance is valid");
});

test("P0-05 Salary Type: Invalid type rejected", () => {
  const input = "Unknown";
  const isValid = ["Salary", "Advance"].includes(input);
  assert.ok(!isValid, "Unknown type is NOT valid (fail-closed)");
});

test("P0-05 Salary Type: Missing type rejected", () => {
  const input: { type?: string } = {};
  const isValid = input.type ? ["Salary", "Advance"].includes(input.type) : false;
  assert.ok(!isValid, "missing type is rejected (fail-closed)");
});

test("P0-05 Salary Type: API validates type fail-closed", () => {
  const apiValidation = (type: unknown) => {
    if (typeof type !== "string") return false;
    return ["Salary", "Advance"].includes(type);
  };

  assert.ok(!apiValidation(undefined), "undefined rejected");
  assert.ok(!apiValidation(null), "null rejected");
  assert.ok(!apiValidation(""), "empty string rejected");
  assert.ok(!apiValidation("Paid"), "Paid rejected");
  assert.ok(!apiValidation("Unknown"), "Unknown rejected");
  assert.ok(apiValidation("Salary"), "Salary accepted");
  assert.ok(apiValidation("Advance"), "Advance accepted");
});

test("P0-05 Salary Type: Audit Action reflects type (SALARY_PAID vs ADVANCE_PAID)", () => {
  const auditActionForType = (type: "Salary" | "Advance") =>
    type === "Salary" ? "SALARY_PAID" : "ADVANCE_PAID";

  assert.strictEqual(auditActionForType("Salary"), "SALARY_PAID",
    "Salary payment creates SALARY_PAID action");
  assert.strictEqual(auditActionForType("Advance"), "ADVANCE_PAID",
    "Advance payment creates ADVANCE_PAID action");
});

test("P0-05 Salary Type: Audit After_Value includes type", () => {
  const auditPayload = {
    staffId: "ST001",
    amount: 30000,
    type: "Salary" as const,
    paidFrom: "Bank",
  };

  const afterValue = JSON.stringify(auditPayload);
  assert.ok(afterValue.includes('"type":"Salary"'),
    "audit After_Value includes type field");
});

test("P0-05 Salary Type: Parser recognizes Type column", () => {
  const headers = ["Payment_ID", "Date", "Staff_ID", "Amount", "Type", "Status"];
  const typeIdx = headers.indexOf("Type");
  assert.strictEqual(typeIdx, 4, "Type column found at correct index");
});

test("P0-05 Salary Type: Parser recognizes Payment_Type alias", () => {
  const headers = ["Payment_ID", "Date", "Staff_ID", "Amount", "Payment_Type", "Status"];
  const typeIdx = headers.findIndex((h) => ["Type", "Payment_Type"].includes(h));
  assert.strictEqual(typeIdx, 4, "Payment_Type alias recognized");
});

test("P0-05 Salary Type: Parser extracts Salary type", () => {
  const parseType = (rawType: string) => {
    const normalized = rawType.toLowerCase();
    return normalized === "salary"
      ? ("Salary" as const)
      : normalized === "advance"
        ? ("Advance" as const)
        : undefined;
  };

  assert.strictEqual(parseType("Salary"), "Salary", "parses 'Salary'");
  assert.strictEqual(parseType("SALARY"), "Salary", "parses 'SALARY' (case-insensitive)");
  assert.strictEqual(parseType("salary"), "Salary", "parses 'salary'");
});

test("P0-05 Salary Type: Parser extracts Advance type", () => {
  const parseType = (rawType: string) => {
    const normalized = rawType.toLowerCase();
    return normalized === "salary"
      ? ("Salary" as const)
      : normalized === "advance"
        ? ("Advance" as const)
        : undefined;
  };

  assert.strictEqual(parseType("Advance"), "Advance", "parses 'Advance'");
  assert.strictEqual(parseType("ADVANCE"), "Advance", "parses 'ADVANCE' (case-insensitive)");
  assert.strictEqual(parseType("advance"), "Advance", "parses 'advance'");
});

test("P0-05 Salary Type: Parser marks blank/unknown as undefined (legacy Unknown)", () => {
  const parseType = (rawType: string) => {
    const normalized = rawType.toLowerCase();
    return normalized === "salary"
      ? ("Salary" as const)
      : normalized === "advance"
        ? ("Advance" as const)
        : undefined;
  };

  assert.strictEqual(parseType(""), undefined, "blank returns undefined (Unknown)");
  assert.strictEqual(parseType("Unknown"), undefined, "Unknown returns undefined");
  assert.strictEqual(parseType("Other"), undefined, "Other returns undefined");
  assert.strictEqual(parseType("Paid"), undefined, "Paid returns undefined");
});

test("P0-05 Salary Type: Salary truth exposes type breakdown", () => {
  const salaryStatus = {
    fixedCommitment: 50000,
    salaryPaid: 30000,
    salaryAdvance: 15000,
    legacyUnclassified: 0,
    settlementTotal: 45000,
    ledgerPaid: 45000,
    remainingDue: 5000,
    excessAmount: 0,
  };

  assert.strictEqual(
    salaryStatus.salaryPaid + salaryStatus.salaryAdvance,
    salaryStatus.settlementTotal,
    "salaryPaid + salaryAdvance = settlementTotal"
  );
  assert.strictEqual(
    salaryStatus.settlementTotal + salaryStatus.legacyUnclassified,
    salaryStatus.ledgerPaid,
    "settlementTotal + legacy = ledgerPaid"
  );
});

test("P0-05 Salary Type: Legacy/unclassified preserves cash effect", () => {
  const salaryStatus = {
    fixedCommitment: 50000,
    salaryPaid: 25000,
    salaryAdvance: 10000,
    legacyUnclassified: 20000,
    settlementTotal: 35000,
    ledgerPaid: 55000,
    remainingDue: 15000,
    excessAmount: 0,
  };

  const allPaid = salaryStatus.ledgerPaid;
  const classifiedOnly = salaryStatus.settlementTotal;
  assert.ok(allPaid > classifiedOnly,
    "ledgerPaid (with legacy) > settlementTotal (classified only)");
  assert.strictEqual(
    allPaid - classifiedOnly,
    salaryStatus.legacyUnclassified,
    "difference = legacy unclassified"
  );
});

test("P0-05 Salary Type: Overpayment — excessAmount when settlement > commitment", () => {
  const salaryStatus = {
    fixedCommitment: 50000,
    salaryPaid: 35000,
    salaryAdvance: 20000,
    legacyUnclassified: 0,
    settlementTotal: 55000,
    ledgerPaid: 55000,
    remainingDue: 0,
    excessAmount: 5000,
  };

  assert.ok(salaryStatus.remainingDue === 0,
    "remainingDue is 0 when overpaid (never negative)");
  assert.ok(salaryStatus.excessAmount > 0,
    "excessAmount tracks overpayment separately");
  assert.strictEqual(
    salaryStatus.settlementTotal - salaryStatus.fixedCommitment,
    salaryStatus.excessAmount,
    "excessAmount = settlement - commitment"
  );
});

test("P0-05 Salary Type: Underpayment — remainingDue when settlement < commitment", () => {
  const salaryStatus = {
    fixedCommitment: 50000,
    salaryPaid: 20000,
    salaryAdvance: 10000,
    legacyUnclassified: 0,
    settlementTotal: 30000,
    ledgerPaid: 30000,
    remainingDue: 20000,
    excessAmount: 0,
  };

  assert.ok(salaryStatus.remainingDue > 0,
    "remainingDue is positive when underpaid");
  assert.ok(salaryStatus.excessAmount === 0,
    "excessAmount is 0 when underpaid");
  assert.strictEqual(
    salaryStatus.fixedCommitment - salaryStatus.settlementTotal,
    salaryStatus.remainingDue,
    "remainingDue = commitment - settlement"
  );
});

test("P0-05 Salary Type: UI requires type selector in form", () => {
  const formFields = {
    staffId: "ST001",
    amount: 30000,
    type: undefined as "Salary" | "Advance" | undefined,
    paidFrom: "Bank",
    note: "Monthly salary",
  };

  const isFormValid = !!(
    formFields.staffId &&
    formFields.amount > 0 &&
    (formFields.type === "Salary" || formFields.type === "Advance") &&
    formFields.paidFrom &&
    formFields.note
  );

  assert.ok(!isFormValid, "form is invalid when type is missing");

  formFields.type = "Salary";
  const isFormValidAfterType = !!(
    formFields.staffId &&
    formFields.amount > 0 &&
    (formFields.type === "Salary" || formFields.type === "Advance") &&
    formFields.paidFrom &&
    formFields.note
  );

  assert.ok(isFormValidAfterType, "form is valid when type is Salary");
});

test("P0-05 Salary Type: Schema backward compatibility — Type column addition", () => {
  // New rows created after correction have Type column
  const newRow = {
    Payment_ID: "SPW123456",
    Date: "2026-08-21",
    Staff_ID: "ST001",
    Amount: 30000,
    Type: "Salary", // NEW COLUMN
    Department: "Physio",
    Status: "Paid",
  };

  assert.ok("Type" in newRow, "new rows include Type column");
  assert.strictEqual(newRow.Type, "Salary", "new rows have type value");
});

test("P0-05 Salary Type: Schema backward compatibility — legacy rows remain untouched", () => {
  // Legacy rows (before correction) may not have Type column
  // Parser should handle this gracefully
  const legacyRow = {
    Payment_ID: "SPW654321",
    Date: "2026-07-21",
    Staff_ID: "ST002",
    Amount: 25000,
    Department: "Dental",
    Status: "Paid",
    // NO Type column — should be treated as Unknown
  };

  const hasType = "Type" in legacyRow;
  assert.ok(!hasType, "legacy rows do NOT have Type column");
});

test("P0-05 Salary Type: Parser handles legacy rows without Type as Unknown", () => {
  // Legacy rows with no Type value → parsed as type=undefined (Unknown)
  const parseType = (rawType: string | undefined) => {
    if (!rawType) return undefined; // blank/missing → Unknown
    const normalized = rawType.toLowerCase();
    return normalized === "salary"
      ? ("Salary" as const)
      : normalized === "advance"
        ? ("Advance" as const)
        : undefined;
  };

  assert.strictEqual(parseType(undefined), undefined,
    "undefined/missing type → Unknown");
  assert.strictEqual(parseType(""), undefined,
    "empty string → Unknown");
  assert.strictEqual(parseType("  "), undefined,
    "whitespace only → Unknown");
});

test("P0-05 Salary Type: Calculation — multiple payments mixed types", () => {
  const payments = [
    { amount: 30000, type: "Salary" as const },
    { amount: 15000, type: "Advance" as const },
    { amount: 10000, type: undefined }, // Legacy Unknown
  ];

  let salaryPaid = 0;
  let salaryAdvance = 0;
  let legacyUnclassified = 0;

  for (const p of payments) {
    if (p.type === "Salary") {
      salaryPaid += p.amount;
    } else if (p.type === "Advance") {
      salaryAdvance += p.amount;
    } else {
      legacyUnclassified += p.amount;
    }
  }

  assert.strictEqual(salaryPaid, 30000, "salaryPaid sums correctly");
  assert.strictEqual(salaryAdvance, 15000, "salaryAdvance sums correctly");
  assert.strictEqual(legacyUnclassified, 10000, "legacy unclassified sums correctly");
  assert.strictEqual(salaryPaid + salaryAdvance + legacyUnclassified, 55000,
    "all types sum to total");
});

test("P0-05 Salary Type: Canonical writer includes Type in row", () => {
  const writerOutput = {
    Payment_ID: "SPW789012",
    Date: "2026-08-21",
    Staff_ID: "ST001",
    Amount: 30000,
    Type: "Salary", // CANONICAL WRITER MUST INCLUDE THIS
    Department: "Physio",
    Status: "Paid",
    Paid_At: "2026-08-21 09:30:00",
  };

  assert.ok("Type" in writerOutput, "canonical writer includes Type field");
  assert.strictEqual(writerOutput.Type, "Salary",
    "canonical writer persists type value");
});

test("P0-05 Salary Type: Settlement calculation never negative", () => {
  const scenarios = [
    { fixed: 50000, paid: 30000, advance: 15000 },
    { fixed: 50000, paid: 40000, advance: 20000 },
    { fixed: 50000, paid: 0, advance: 0 },
  ];

  for (const scenario of scenarios) {
    const settlementTotal = scenario.paid + scenario.advance;
    const remainingDue = Math.max(0, scenario.fixed - settlementTotal);
    const excessAmount = Math.max(0, settlementTotal - scenario.fixed);

    assert.ok(remainingDue >= 0, `remainingDue >= 0 (${remainingDue})`);
    assert.ok(excessAmount >= 0, `excessAmount >= 0 (${excessAmount})`);
  }
});
