import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legacy single-date AppointmentForm is removed while multi-date booking remains", () => {
  const legacy = new URL("../components/AppointmentForm.tsx", import.meta.url);
  assert.equal(existsSync(legacy), false);
  const bookingPage = source("app/(dashboard)/appointments/new/page.tsx");
  assert.match(bookingPage, /AppointmentFormMultiDate/);
});

test("bulk import keeps canonical patient registration safety", () => {
  const route = source("app/api/patients/bulk-import/route.ts");
  assert.match(route, /isAllowedRequestOrigin/);
  assert.match(route, /canPerform\(access, "patient\.create", department\)/);
  assert.match(route, /withMutationLock\(`patient-register:\$\{department\}`/);
  assert.match(route, /registerPatient\(access/);
  assert.match(route, /consumePhysioInventorySystem/);
  assert.match(route, /Physio gender must be Male or Female/);
  assert.doesNotMatch(route, /split\(","\)/);
});

test("finance request forms reuse canonical finance APIs", () => {
  const expense = source("components/ExpenseRequestForm.tsx");
  const cash = source("components/CashMovementForm.tsx");
  assert.match(expense, /\/api\/finance\/expense\/request/);
  assert.match(expense, /requestId/);
  assert.doesNotMatch(expense, /\/api\/expense\/request/);
  assert.match(cash, /\/api\/finance\/cash\/request/);
  assert.match(cash, /Home Treasury/);
  assert.match(cash, /Bank/);
  assert.doesNotMatch(cash, /bank_to_reception|treasury_to_bank/);
});

test("CSV export requires report permissions and department intersection", () => {
  const route = source("app/api/export/csv/route.ts");
  assert.match(route, /report\.read_operational/);
  assert.match(route, /report\.read_financial/);
  assert.match(route, /allowedDepartments\(context, requested, permissionActions\(type\)\)/);
  assert.match(route, /objectsToCsv/);
  assert.match(route, /X-Content-Type-Options/);
});

test("fake treatment-photo persistence is not imported", () => {
  assert.equal(existsSync(new URL("../app/api/patients/treatment-photo/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/TreatmentPhotoUpload.tsx", import.meta.url)), false);
  const patientPage = source("app/(dashboard)/patients/[patientId]/page.tsx");
  assert.match(patientPage, /PatientReportUpload/);
  assert.match(patientPage, /PatientMediaGallery/);
});

test("new workspaces are discoverable from More and Dental tools use canonical register data", () => {
  const more = source("app/(dashboard)/more/page.tsx");
  const dental = source("app/(dashboard)/tools/dental/page.tsx");
  assert.match(more, /\/patients\/bulk-import/);
  assert.match(more, /\/reports\/export/);
  assert.match(more, /\/finance\/expense-request/);
  assert.match(more, /\/finance\/cash-movement/);
  assert.match(more, /\/tools\/dental/);
  assert.match(dental, /getDailyRegisterSnapshot\(context, "dental"/);
  assert.doesNotMatch(dental, /getDentalParitySnapshot/);
});
