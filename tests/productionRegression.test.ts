import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("staff directory reads production access mapping columns", () => {
  const staff = source("lib/webos/staffDirectory.ts");
  assert.match(staff, /Role_Snapshot/);
  assert.match(staff, /Clinical_Write_Scope/);
  assert.match(staff, /Financial_Access/);
  assert.match(staff, /clinicalByStaff/);
  assert.match(staff, /financialByStaff/);
});

test("cash handover cannot create a negative Reception balance", () => {
  const request = source("app/api/finance/cash/request/route.ts");
  const accept = source("app/api/finance/cash/accept/route.ts");
  for (const value of [request, accept]) {
    assert.match(value, /getScopedCashPosition/);
    assert.match(value, /INSUFFICIENT_RECEPTION_CASH/);
  }
  assert.match(accept, /getPendingCashMovements/);
});

test("dashboard date is explicitly Dhaka local", () => {
  const format = source("lib/format.ts");
  assert.match(format, /timeZone: "Asia\/Dhaka"/);
});

test("Chamber calls are explicit targets and only ring in chamber hours", () => {
  const listener = source("components/ChamberAlertListener.tsx");
  const directCall = source("components/ChamberDirectCall.tsx");
  const layout = source("app/(dashboard)/layout.tsx");
  const chamber = source("app/(dashboard)/chamber/page.tsx");

  assert.match(listener, /CALL:STAFF:/);
  assert.match(listener, /CALL:ROLE:/);
  assert.match(listener, /ALERT_START_HOUR = 9/);
  assert.match(listener, /ALERT_END_HOUR = 21/);
  assert.match(listener, /ALERT_VISIBLE_MS = 60_000/);
  assert.match(listener, /requireInteraction: false/);
  assert.match(directCall, /Call the right person/);
  assert.match(directCall, /roomId: `CALL:/);
  assert.match(layout, /currentRoles=\{context\.roles\}/);
  assert.match(chamber, /ChamberDirectCall/);
});

test("owner attention links preserve the intended destination", () => {
  const home = source("app/(dashboard)/home/page.tsx");
  const financeOps = source("app/(dashboard)/finance/operations/page.tsx");
  assert.match(home, /scope=combined&focus=exceptions/);
  assert.match(financeOps, /href="\/finance#approvals"/);
  assert.doesNotMatch(financeOps, /href="\/more#approvals"/);
});

test("appointments honor scope exception focus and calendar continuity", () => {
  const page = source("app/(dashboard)/appointments/page.tsx");
  const client = source("components/AppointmentsWorkspaceClient.tsx");
  assert.match(page, /params\.scope/);
  assert.match(page, /focusExceptions/);
  assert.match(page, /initialTab/);
  assert.match(client, /new URLSearchParams\(\{ date: next, scope \}\)/);
  assert.match(client, /params\.set\("tab", tab\)/);
  assert.match(client, /params\.set\("focus", "exceptions"\)/);
  assert.match(client, /Fix patient gender/);
});

test("Chamber booking always opens in one viewport and gender fixes stay inside the warning", () => {
  const nav = source("components/BottomNav.tsx");
  const tabs = source("components/ChamberWorkspaceTabs.tsx");
  const assist = source("components/ChamberBookingAssist.tsx");
  assert.match(nav, /tab=team&team=messages#chamber-team-panel/);
  assert.match(tabs, /ChamberBookingAssist/);
  assert.match(assist, /patient gender must be set/);
  assert.match(assist, /JSON\.stringify\(\{ gender \}\)/);
  assert.match(assist, /dialog\.style\.top = "68px"/);
  assert.match(assist, /dialog\.style\.bottom = "72px"/);
  assert.match(assist, /sheet\.style\.height = "100%"/);
  assert.match(assist, /createPortal/);
  assert.match(assist, /data-relife-gender-fix/);
  assert.match(assist, /Set gender here/);
  assert.doesNotMatch(assist, /fixed left-3 right-3/);
  assert.match(assist, /router\.refresh\(\)/);
});

test("new Physio registration requires gender while Dental can remain optional", () => {
  const route = source("app/api/patients/route.ts");
  const form = source("components/PatientRegistrationForm.tsx");
  assert.match(route, /department === "Physio"/);
  assert.match(route, /INVALID_PATIENT_GENDER/);
  assert.match(form, /physioGenderRequired = department === "Physio"/);
  assert.match(form, /Gender \{physioGenderRequired \? "\*" : "\(optional\)"\}/);
  assert.match(form, /allowClear=\{!physioGenderRequired\}/);
  assert.match(form, /physioGenderRequired && !gender/);
});

test("Chamber completion attempts an audited clinical treatment note", () => {
  const route = source("app/api/chamber/route.ts");
  const note = source("lib/webos/chamberClinicalNote.ts");
  assert.match(route, /captureChamberTreatmentForCompletion/);
  assert.match(route, /recordChamberCompletionTreatmentNote/);
  assert.match(route, /noteSaved: true/);
  assert.match(note, /05_Treatments/);
  assert.match(note, /\[CHAMBER_SESSION:/);
  assert.match(note, /clinical\.session\.auto_from_chamber/);
});

test("Home and Daily Ops count completed clinical work instead of payment session remarks", () => {
  const home = source("app/(dashboard)/home/page.tsx");
  const daily = source("app/(dashboard)/daily/page.tsx");
  const activity = source("lib/webos/dailyClinicalActivity.ts");

  for (const page of [home, daily]) {
    assert.match(page, /getDailyClinicalActivity/);
    assert.doesNotMatch(page, /paymentSessionCount/);
    assert.doesNotMatch(page, /todayPayments/);
  }
  assert.match(activity, /05_Treatments/);
  assert.match(home, /Patients treated/);
  assert.match(home, /Sessions done/);
});

test("patient report upload uses private Supabase Storage instead of Google Drive", () => {
  const route = source("app/api/tools/report-upload/route.ts");
  const storage = source("lib/webos/reportStorage.ts");
  const media = source("app/api/patients/[patientId]/reports/[reportId]/media/route.ts");
  const edge = source("supabase/functions/relife-report-storage/index.ts");
  const migration = source("supabase/migrations/20260817120100_private_patient_report_storage.sql");

  assert.match(route, /uploadPatientReportToPrivateStorage/);
  assert.doesNotMatch(route, /uploadPatientReport\} from "@\/lib\/webos\/reportDrive"/);
  assert.match(storage, /REPORT_STORAGE_EDGE_SECRET/);
  assert.match(storage, /supabase:\/\/\$\{REPORT_BUCKET\}\//);
  assert.match(storage, /await deleteObject\(path\)/);
  assert.match(media, /reportStoragePathFromLink/);
  assert.match(media, /downloadPrivatePatientReport/);
  assert.match(edge, /x-relife-report-key/);
  assert.match(edge, /relife-patient-reports/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(migration, /'relife-patient-reports'/);
  assert.match(migration, /false/);
  assert.match(migration, /12582912/);
});

test("Patient File cache is cleared after create, edit and payment writes", () => {
  const patients = source("lib/patients.ts");
  const createPatient = source("app/api/patients/route.ts");
  const editPatient = source("app/api/patients/[patientId]/route.ts");
  const payment = source("app/api/finance/payment/route.ts");

  assert.match(patients, /export function invalidatePatientsCache/);
  assert.match(patients, /patientCache = undefined/);
  for (const route of [createPatient, editPatient, payment]) {
    assert.match(route, /invalidatePatientsCache\(\)/);
  }
});
