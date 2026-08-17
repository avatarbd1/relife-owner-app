import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function functionBlock(text: string, startMarker: string, nextMarker: string): string {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = text.indexOf(nextMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${nextMarker}`);
  return text.slice(start, end);
}

test("Dental registration explicitly keeps phone optional and blank phones bypass duplicate matching", () => {
  const form = source("components/PatientRegistrationForm.tsx");
  const reception = source("lib/webos/reception.ts");
  const register = functionBlock(
    reception,
    "export async function registerPatient",
    "function parseDepartment"
  );

  assert.match(form, /Phone \{department === "Dental"[^\n]+\(optional\)/);
  const phoneInput = form.match(/<input value=\{phone\}[^>]*>/)?.[0] ?? "";
  assert.ok(phoneInput, "primary phone input must exist");
  assert.doesNotMatch(phoneInput, /\brequired\b/);

  assert.match(register, /const phone = normalizePhone\(input\.phone\);\s*if \(phone\) \{/s);
  assert.match(register, /Phone: quotePhone\(input\.phone \|\| ""\)/);
  assert.doesNotMatch(register, /PHONE_REQUIRED|INVALID_PHONE/);
});

test("Patient registration serializes the full department create path and invalidates read cache", () => {
  const route = source("app/api/patients/route.ts");
  const lock = route.indexOf("patient-register:${department || \"unknown\"}");
  const register = route.indexOf("registerPatient(context");
  const invalidate = route.indexOf("invalidatePatientsCache()");

  assert.ok(lock >= 0, "department registration lock must exist");
  assert.ok(register > lock, "registerPatient must execute under the registration lock");
  assert.ok(invalidate > register, "patient cache must invalidate after successful registration");
});

test("Patient update resolves authorized department then uses the canonical patient lock", () => {
  const route = source("app/api/patients/[patientId]/route.ts");
  const resolve = route.indexOf("getPatientForContext(context, decodedPatientId)");
  const lock = route.indexOf("patient:${patient.department}:${decodedPatientId}");
  const update = route.indexOf("updatePatientProfile(context, decodedPatientId");
  const invalidate = route.indexOf("invalidatePatientsCache()");

  assert.ok(resolve >= 0, "server must resolve the patient through access context");
  assert.ok(lock > resolve, "department must come from the authorized patient record before locking");
  assert.ok(update > lock, "profile mutation must execute under the canonical patient lock");
  assert.ok(invalidate > update, "patient cache must invalidate after successful update");
  assert.match(route, /if \(!patient \|\| patient\.department === "All"\)/);
});

test("Patient Hub exposes the canonical authorized workspace from one patient file", () => {
  const page = source("app/(dashboard)/patients/[patientId]/page.tsx");

  assert.match(page, /getPatientForContext\(context, decodeURIComponent\(patientId\)\)/);
  assert.match(page, /\{patient\.fullName\}/);
  assert.match(page, /\{patient\.patientId\}/);
  assert.match(page, /\{patient\.department\}/);

  assert.match(page, /const canEditPatient = canPerform\(context, "patient\.update"/);
  assert.match(page, /const canCreateAppointment = canPerform\(context, "appointment\.create"/);
  assert.match(page, /const canCreatePayment = canPerform\(context, "payment\.create"/);
  assert.match(page, /const canSeeClinical = canPerform\(context, "clinical\.read"/);
  assert.match(page, /const canSeeReports = canPerform\(context, "patient\.report\.read"/);
  assert.match(page, /const canUploadReports = canPerform\(context, "patient\.report\.upload"/);

  assert.match(page, /<PatientEditForm/);
  assert.match(page, /\/appointments\/new\?patientId=/);
  assert.match(page, /\/payments\?patientId=/);
  assert.match(page, /\/patients\/\$\{encodeURIComponent\(patient\.patientId\)\}\/clinical/);
  assert.match(page, /<PatientMediaGallery/);
  assert.match(page, /Appointment history/);
  assert.match(page, /getUnifiedPatientAppointmentsForContext\(context, patient\)/);
});

test("Patient Hub payment deep-link uses the canonical payment workspace and refreshes patient totals", () => {
  const patientPage = source("app/(dashboard)/patients/[patientId]/page.tsx");
  const paymentsPage = source("app/(dashboard)/payments/page.tsx");
  const paymentApi = source("app/api/finance/payment/route.ts");

  assert.match(patientPage, /href=\{`\/payments\?patientId=\$\{encodeURIComponent\(patient\.patientId\)\}`\}/);
  assert.match(paymentsPage, /searchParams: Promise<\{ patientId\?: string \}>/);
  assert.match(paymentsPage, /initialPatientId=\{params\.patientId\}/);
  assert.match(paymentApi, /invalidatePatientsCache\(\)/);
});

test("All patient-scoped clinical writes share the canonical per-patient distributed lock", () => {
  const assessment = source("app/api/clinical/assessment/route.ts");
  const plan = source("app/api/clinical/plan/route.ts");
  const session = source("app/api/clinical/session/route.ts");
  const dental = source("app/api/clinical/dental/route.ts");

  for (const physioRoute of [assessment, plan, session]) {
    assert.match(physioRoute, /withMutationLock\(`patient:Physio:\$\{patientId\}`/);
  }
  assert.match(dental, /withMutationLock\(`patient:Dental:\$\{patientId\}`/);
  assert.doesNotMatch(session, /clinical-session:\$\{patientId\}/);
});

test("Treatment-plan and session read-check-write logic remains inside the locked route call", () => {
  const clinical = source("lib/webos/clinical.ts");
  const plan = functionBlock(clinical, "export async function createTreatmentPlan", "export async function recordTreatmentSession");
  const sessionStart = clinical.indexOf("export async function recordTreatmentSession");
  assert.notEqual(sessionStart, -1);
  const session = clinical.slice(sessionStart);

  assert.match(plan, /fetchSheetRanges\("physio", \["12_Treatment_Plans"\]\)/);
  assert.match(plan, /status\.toLowerCase\(\) === "active"/);
  assert.match(plan, /value: "Superseded"/);

  assert.match(session, /fetchSheetRanges\("physio", \["12_Treatment_Plans", "05_Treatments"\]\)/);
  assert.match(session, /const sessionNo = sessions\.filter[^\n]+\.length \+ 1/);
  assert.match(session, /value: sessionNo/);
});

test("Direct patient and clinical pages resolve patients through server-side access context", () => {
  const patientPage = source("app/(dashboard)/patients/[patientId]/page.tsx");
  const clinicalPage = source("app/(dashboard)/patients/[patientId]/clinical/page.tsx");
  const updateApi = source("app/api/patients/[patientId]/route.ts");

  for (const file of [patientPage, clinicalPage, updateApi]) {
    assert.match(file, /getPatientForContext\(context,/);
  }
  assert.match(patientPage, /if \(!patient \|\| patient\.department === "All"\) notFound\(\)/);
  assert.match(clinicalPage, /if \(!patient \|\| patient\.department === "All"\) notFound\(\)/);
});

test("Google Sheets remains patient authority while lib/patients is only a short-lived read cache", () => {
  const patients = source("lib/patients.ts");
  const reception = source("lib/webos/reception.ts");
  const update = source("lib/webos/patientUpdate.ts");

  assert.match(patients, /fetchSheetRanges\("physio", \["02_Patients"\]\)/);
  assert.match(patients, /fetchSheetRanges\("dental", \["02_Patients"\]\)/);
  assert.match(patients, /const CACHE_MS = 30_000/);
  assert.match(reception, /appendEntityWithAudit\([\s\S]*?"02_Patients"/);
  assert.match(update, /replaceEntityRowWithAudit\([\s\S]*?"02_Patients"/);
});
