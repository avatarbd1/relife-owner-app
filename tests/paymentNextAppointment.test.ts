import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("saved payment offers a one-tap next appointment for the same patient", () => {
  const payments = source("components/PaymentsWorkspaceClient.tsx");
  assert.match(payments, /Next appointment/);
  assert.match(
    payments,
    /\/appointments\/new\?patientId=\$\{encodeURIComponent\(receipt\.patientId\)\}&department=\$\{receipt\.department\}/
  );
});

test("new appointment page honors patient and department query defaults", () => {
  const appointment = source("app/(dashboard)/appointments/new/page.tsx");
  assert.match(appointment, /patientId\?: string; department\?: string/);
  assert.match(appointment, /defaultPatientId=\{patientId\}/);
  assert.match(appointment, /defaultDepartment=\{defaultDepartment\}/);
});
