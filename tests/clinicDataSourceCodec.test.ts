import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeSheetsPatientSourceRef,
  parseSheetsPatientSourceRef,
} from "../lib/domain/tenancy/clinicDataSourceCodec.ts";

test("parses a well-formed sheets_workbook/patients source_ref for a non-Relife clinic", () => {
  const ref = encodeSheetsPatientSourceRef({
    workbook: "physio",
    department: "Physio",
    legacyOrganizationId: "QA-DUMMY-ORG",
    legacyClinicId: "QA-DUMMY-CLINIC",
  });
  const source = parseSheetsPatientSourceRef("org-uuid-1", "clinic-uuid-1", ref);
  assert.deepEqual(source, {
    organizationId: "org-uuid-1",
    clinicId: "clinic-uuid-1",
    workbook: "physio",
    department: "Physio",
    legacyOrganizationId: "QA-DUMMY-ORG",
    legacyClinicId: "QA-DUMMY-CLINIC",
  });
});

test("parses the real Relife/Physio row the same generic way", () => {
  const ref = encodeSheetsPatientSourceRef({
    workbook: "physio",
    department: "Physio",
    legacyOrganizationId: "RELIFE",
    legacyClinicId: "RELIFE-PHYSIO",
  });
  const source = parseSheetsPatientSourceRef("relife-org-uuid", "amtali-main-uuid", ref);
  assert.equal(source?.legacyOrganizationId, "RELIFE");
  assert.equal(source?.legacyClinicId, "RELIFE-PHYSIO");
});

test("rejects malformed JSON", () => {
  assert.equal(parseSheetsPatientSourceRef("org", "clinic", "not-json"), null);
});

test("rejects an unknown workbook or department instead of silently defaulting", () => {
  assert.equal(
    parseSheetsPatientSourceRef(
      "org",
      "clinic",
      JSON.stringify({
        workbook: "orthodontics",
        department: "Physio",
        legacyOrganizationId: "X",
        legacyClinicId: "Y",
      })
    ),
    null
  );
  assert.equal(
    parseSheetsPatientSourceRef(
      "org",
      "clinic",
      JSON.stringify({
        workbook: "physio",
        department: "Pediatrics",
        legacyOrganizationId: "X",
        legacyClinicId: "Y",
      })
    ),
    null
  );
});

test("rejects a source_ref missing legacy identity fields", () => {
  assert.equal(
    parseSheetsPatientSourceRef(
      "org",
      "clinic",
      JSON.stringify({ workbook: "physio", department: "Physio" })
    ),
    null
  );
});
