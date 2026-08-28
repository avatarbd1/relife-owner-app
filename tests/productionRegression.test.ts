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

test("Chamber direct calls and guarded emergency broadcasts ring until accepted", () => {
  const listener = source("components/ChamberAlertListener.tsx");
  const directCall = source("components/ChamberDirectCall.tsx");
  const commsClient = source("components/ChamberCommsClient.tsx");
  const route = source("app/api/chamber/comms/route.ts");
  const comms = source("lib/webos/chamberComms.ts");
  const layout = source("app/(dashboard)/layout.tsx");
  const chamber = source("app/(dashboard)/chamber/page.tsx");

  assert.match(listener, /CALL:STAFF:/);
  assert.match(listener, /CALL:ROLE:/);
  assert.match(listener, /BROADCAST_MARKER = "CALL:ALL:PHYSIO"/);
  assert.match(listener, /ALERT_START_HOUR = 9/);
  assert.match(listener, /ALERT_END_HOUR = 21/);
  assert.match(listener, /CALL_GAIN = 1/);
  assert.match(listener, /RING_INTERVAL_MS = 1_100/);
  assert.match(listener, /oscillator\.type = "square"/);
  assert.match(listener, /window\.setInterval\(\(\) => void pulse\(\), RING_INTERVAL_MS\)/);
  assert.match(listener, /action: "accept_call"/);
  assert.match(listener, /Acknowledge emergency/);
  assert.match(listener, /requireInteraction: true/);
  assert.doesNotMatch(listener, /ALERT_VISIBLE_MS/);
  assert.doesNotMatch(listener, />\s*Dismiss\s*</);

  assert.match(directCall, /Until accepted/);
  assert.match(directCall, /waiting for acceptance/);
  assert.match(directCall, /roomId: `CALL:/);
  assert.match(directCall, /Emergency broadcast/);
  assert.match(directCall, /action: "broadcast_emergency"/);
  assert.match(directCall, /window\.confirm/);
  assert.match(directCall, /first authorized acknowledgement stops the broadcast on all devices/);

  assert.match(route, /action === "broadcast_emergency"/);
  assert.match(route, /PHYSIO_EMERGENCY_MARKER = "CALL:ALL:PHYSIO"/);
  assert.match(route, /chamber-emergency-broadcast/);
  assert.match(route, /action === "accept_call"/);
  assert.match(route, /chamber-call:\$\{messageId\}/);
  assert.match(route, /acceptChamberCall\(access, tenant\.organizationId, tenant\.clinicId, messageId\)/);

  assert.match(comms, /BROADCAST_MARKER = "CALL:ALL:PHYSIO"/);
  assert.match(comms, /function canSendEmergencyBroadcast/);
  assert.match(comms, /role === "Owner" \|\| role === "Manager"/);
  assert.match(comms, /roomId\.startsWith\("CALL:ALL:"\)/);
  assert.match(comms, /chamber\.broadcast\.send/);
  assert.match(comms, /chamber\.broadcast\.accept/);
  assert.match(comms, /export async function acceptChamberCall/);
  assert.match(comms, /CALL_TARGET_MISMATCH/);
  assert.match(comms, /headerIndex\(headers, "Seen_By"\)/);
  assert.match(comms, /row\[statusIdx\] = "Accepted"/);
  assert.match(comms, /replaceEntityRowWithAudit/);
  assert.match(comms, /normalized\(item\.status \|\| "Active"\) === "active"/);

  assert.match(commsClient, /Phone-style ring is reserved for Direct Call and authorized Emergency Broadcast/);
  assert.match(commsClient, /High-priority Team message/);
  assert.match(commsClient, /not phone-style calls/);
  assert.doesNotMatch(commsClient, /10-sec call alert/);
  assert.doesNotMatch(commsClient, /urgent 10-second Chamber call/);

  assert.match(layout, /currentRoles=\{context\.roles\}/);
  assert.match(chamber, /canBroadcast = context\.roles\.some/);
  assert.match(chamber, /<ChamberDirectCall targets=\{callTargets\} canBroadcast=\{canBroadcast\}/);
});

test("owner attention links preserve the intended destination", () => {
  const home = source("app/(dashboard)/home/page.tsx");
  const financeOps = source("app/(dashboard)/finance/operations/page.tsx");
  assert.match(home, /scope=\$\{runtimeScope\}&focus=exceptions/);
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

test("Home and Daily Ops count completed operational work instead of payment session remarks", () => {
  const home = source("app/(dashboard)/home/page.tsx");
  const daily = source("app/(dashboard)/daily/page.tsx");
  const activity = source("lib/webos/dailyClinicalActivity.ts");

  assert.match(home, /getAppointmentsForContext\(context, runtimeScope, today, tenant\.organizationId, tenant\.clinicId\)/);
  assert.match(home, /status\.trim\(\)\.toLowerCase\(\) === "completed"/);
  assert.match(daily, /getDailyClinicalActivity/);
  for (const page of [home, daily]) {
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
