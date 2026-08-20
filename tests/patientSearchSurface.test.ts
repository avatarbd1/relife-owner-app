import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("PatientsClient delegates matching to the ranked patient search domain", () => {
  const client = source("components/PatientsClient.tsx");

  assert.match(client, /@\/lib\/domain\/patients\/search/);
  assert.match(client, /searchPatients\(patients/);
  assert.match(client, /বাংলা\/English digits both work/);
  assert.match(client, /best first/);
  assert.doesNotMatch(client, /\.toLowerCase\(\)\.includes\(normalized\)/);
});

test("patient search no longer hides everything after a fixed first-60 cutoff", () => {
  const client = source("components/PatientsClient.tsx");

  assert.match(client, /PAGE_SIZE = 30/);
  assert.match(client, /Load more/);
  assert.match(client, /setVisibleCount\(\(current\) => current \+ PAGE_SIZE\)/);
  assert.doesNotMatch(client, /slice\(0, 60\)/);
  assert.doesNotMatch(client, /First 60 results shown/);
});

test("patient search remains role-scoped and keeps workflow permission inputs", () => {
  const page = source("app/(dashboard)/patients/page.tsx");
  const client = source("components/PatientsClient.tsx");

  assert.match(page, /getVisiblePatients\(context, scope\)/);
  assert.match(page, /paymentDepartments=\{\[\.\.\.paymentDepartments\]\}/);
  assert.match(page, /appointmentDepartments=\{\[\.\.\.appointmentDepartments\]\}/);
  assert.match(client, /paymentDepartments\.includes\(patient\.department\)/);
  assert.match(client, /appointmentDepartments\.includes\(patient\.department\)/);
});

test("search is rendered before summary and workflow cards on the Patients page", () => {
  const page = source("app/(dashboard)/patients/page.tsx");
  const searchIndex = page.indexOf("<PatientsClient");
  const snapshotIndex = page.indexOf('<Section title="Patient snapshot"');
  const workflowIndex = page.indexOf('<Section title="Patient workflows"');

  assert.ok(searchIndex >= 0);
  assert.ok(snapshotIndex > searchIndex);
  assert.ok(workflowIndex > searchIndex);
});

test("patient result actions are mobile-first instead of three cramped buttons", () => {
  const client = source("components/PatientsClient.tsx");

  assert.match(client, /View patient file/);
  assert.match(client, /min-h-12 w-full/);
  assert.match(client, /canPay && canBook \? "grid-cols-2" : "grid-cols-1"/);
  assert.doesNotMatch(client, /grid-cols-3/);
});
