import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Physio clinical history accepts only the canonical clinic and the authorized patient ledger clinic", () => {
  const clinical = source("lib/webos/clinical.ts");
  assert.match(
    clinical,
    /const patient = await requirePhysioPatient\(context, patientId\)[\s\S]*new Set\([\s\S]*\[clinicId, patient\.clinicId\]\.filter/
  );
  assert.match(clinical, /allowedClinicIds\.has\(rowClinicId\)/);
  assert.doesNotMatch(clinical, /new Set\(\[[^\]]*RELIFE-PHYSIO/);
});

test("Dental clinical history uses the same authorized-patient compatibility boundary", () => {
  const clinical = source("lib/webos/dentalClinical.ts");
  assert.match(
    clinical,
    /const patient = await requireDentalPatient\(context, normalize\(patientId\)\)[\s\S]*new Set\([\s\S]*\[clinicId, patient\.clinicId\]\.filter/
  );
  assert.match(clinical, /allowedClinicIds\.has\(rowClinicId\)/);
  assert.doesNotMatch(clinical, /new Set\(\[[^\]]*RELIFE-DENTAL/);
});

test("clinical writers remain canonical and explicitly tenant-scoped", () => {
  for (const path of ["lib/webos/clinical.ts", "lib/webos/dentalClinical.ts"]) {
    const clinical = source(path);
    assert.match(clinical, /organizationId: string,\s*clinicId: string/);
    assert.match(clinical, /Organization_ID: organizationId/);
    assert.match(clinical, /Clinic_ID: clinicId/);
  }
});
