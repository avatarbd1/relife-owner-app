import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * First vertical slice wiring contract.
 *
 * These assertions are about routing and fail-closed behaviour, which is what
 * can actually go wrong here: a clinic reading the wrong store shows either
 * nothing or somebody else's patients, and neither failure announces itself.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read("../supabase/migrations/20260829090000_operational_core_foundation.sql");
const router = read("../lib/domain/operations/store.ts");
const adapter = read("../lib/data/supabaseOperational.ts");
const reception = read("../lib/webos/reception.ts");
const serialRegistration = read("../lib/webos/registerPatientSerial.ts");
const patientUpdate = read("../lib/webos/patientUpdate.ts");
const appointmentStatus = read("../lib/webos/appointmentStatus.ts");
const payments = read("../lib/domain/finance/payments.ts");
const calculations = read("../lib/calculations.ts");

const WIRED_PATHS: Array<[string, string]> = [
  ["reception", reception],
  ["registerPatientSerial", serialRegistration],
  ["patientUpdate", patientUpdate],
  ["appointmentStatus", appointmentStatus],
  ["payments", payments],
  ["calculations", calculations],
];

test("every wired path routes through the one shared store decision", () => {
  for (const [name, source] of WIRED_PATHS) {
    assert.match(source, /isTenantNativeClinic/, name);
    assert.match(source, /from "@\/lib\/domain\/operations\/store"/, name);
  }
});

test("the store decision comes from the server tenant, never from the browser", () => {
  // The resolver takes a TenantScope and reads the clinic's own setting. It
  // must not accept a store, or a tenant, handed in by a request body.
  assert.match(router, /requireTenantScope\(scope\)/);
  assert.match(router, /readOperationalStore\(tenant\)/);
  assert.doesNotMatch(router, /request|body|searchParams|headers|cookie/i);
});

test("an unconfigured or unknown store stops the request instead of guessing", () => {
  assert.match(router, /resolveOperationalStore\(await readOperationalStore\(tenant\)\)/);
  // Both directions are guarded, so neither store can serve the other's clinic.
  assert.match(router, /OPERATIONAL_STORE_MISMATCH/);
});

test("a Sheets clinic cannot write into the operational tables even if routing is wrong", () => {
  // The application guard can be bypassed by a bug; this one cannot, because
  // it runs inside the same transaction as the insert.
  const guard = migration.match(
    /create or replace function relife\.assert_tenant_native_store[\s\S]*?\n\$\$;/,
  )?.[0] || "";
  assert.match(guard, /OPERATIONAL_STORE_NOT_CONFIGURED/);
  assert.match(guard, /v_store <> 'supabase'/);
  assert.match(guard, /OPERATIONAL_STORE_MISMATCH:supabase/);

  for (const fn of [
    "register_patient_v1",
    "book_appointment_v1",
    "record_payment_v1",
    "update_patient_profile_v1",
    "update_appointment_status_v1",
  ]) {
    const body = migration.match(new RegExp(`create or replace function relife\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] || "";
    assert.ok(body, fn);
    assert.match(body, /perform relife\.assert_tenant_native_store\(p_organization_id, p_clinic_id\)/, fn);
  }
});

test("a tenant-native clinic never falls back to a Sheets read or write", () => {
  // Each branch returns from the native adapter; the Sheets code below it is
  // only reachable for a Sheets clinic.
  const nativeBranches: Array<[string, string, RegExp]> = [
    ["visible patients", reception, /isTenantNativeClinic\(tenant\)\)\s*\{\s*\n\s*return \(await readPatients\(tenant\)\)/],
    ["single patient", reception, /isTenantNativeClinic\(tenant\)\)\s*\{[\s\S]{0,300}?readPatient\(tenant/],
    ["bulk patient create", reception, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\{[\s\S]{0,200}?return insertPatient\(/],
    ["appointment create", reception, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\{[\s\S]{0,300}?return insertAppointment\(/],
    ["serial patient create", serialRegistration, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\{[\s\S]{0,200}?return insertPatient\(/],
    ["patient update", patientUpdate, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\{\s*\n\s*return updatePatientProfileRow\(/],
    ["appointment status", appointmentStatus, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\{[\s\S]{0,300}?updateAppointmentStatusRow\(/],
    ["payment create", payments, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\{[\s\S]{0,1400}?return \{ receiptNo: recorded\.receiptNo/],
  ];
  for (const [name, source, pattern] of nativeBranches) {
    assert.match(source, pattern, name);
  }
});

test("appointment and patient reads are store-routed, not Sheets-only", () => {
  assert.match(reception, /isTenantNativeClinic\(tenant\)\)\s*\n?\s*\?\s*await readAppointments\(tenant, date \? \{ date \} : \{\}\)/);
  assert.match(reception, /isTenantNativeClinic\(tenant\)\)\s*\n?\s*\?\s*await readAppointments\(tenant, \{ patientId: patient\.patientId \}\)/);
  // Collections on Home/Finance must read the clinic's own ledger.
  assert.match(calculations, /isTenantNativeClinic\(\{ organizationId, clinicId \}\)\)\s*\n?\s*\?\s*await readPayments\(/);
});

test("the payment balance rule is identical in both stores", () => {
  // Two persistence paths, one accounting rule. If these ever drift, the same
  // receipt would leave a different balance depending on the clinic's store.
  const native = payments.match(/const currentDue = Math\.max\(0, Number\(patient\.due\)[\s\S]*?paymentStatus: newDue <= 0 \? "Paid" : "Due",/)?.[0] || "";
  assert.ok(native, "native balance block must exist");
  assert.match(native, /const discountedDue = Math\.max\(0, currentDue - discount\)/);
  assert.match(native, /const newDue = Math\.max\(0, discountedDue - amount\)/);
  assert.match(native, /const overpayment = currentDue > 0 \? Math\.max\(0, amount - discountedDue\) : 0/);

  const sheets = payments.match(/const discountedDue = Math\.max\(0, currentDue - discount\);[\s\S]*?const paymentStatus = newDue <= 0 \? "Paid" : "Due";/)?.[0] || "";
  assert.ok(sheets, "sheets balance block must exist");
  assert.match(sheets, /const newDue = Math\.max\(0, discountedDue - amount\)/);
  assert.match(sheets, /const overpayment = currentDue > 0 \? Math\.max\(0, amount - discountedDue\) : 0/);
});

test("a payment writes the receipt, the balance and the audit or none of them", () => {
  const fn = migration.match(/create or replace function relife\.record_payment_v1[\s\S]*?\n\$\$;/)?.[0] || "";
  assert.match(fn, /insert into relife\.payments/);
  assert.match(fn, /update relife\.patients/);
  assert.match(fn, /insert into relife\.audit_events/);
  // One function body, therefore one transaction: a failure after the receipt
  // cannot leave the patient balance advanced on its own.
  assert.equal((fn.match(/\bcommit\b/g) || []).length, 0);
});

test("a retried mutation returns the original record rather than a second one", () => {
  for (const [fn, key] of [
    ["register_patient_v1", "patientId"],
    ["book_appointment_v1", "appointmentId"],
    ["record_payment_v1", "receiptNo"],
  ] as const) {
    const body = migration.match(new RegExp(`create or replace function relife\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] || "";
    assert.match(body, new RegExp(`where[\\s\\S]*?request_id = p_request_id`), fn);
    assert.match(body, new RegExp(`'${key}',[\\s\\S]{0,80}'duplicate', true`), fn);
  }
});

test("cross-clinic patients cannot be booked or billed", () => {
  // Enforced twice: the writer resolves the patient inside the tenant, and the
  // composite foreign key refuses the row even if that check were removed.
  for (const fn of ["book_appointment_v1", "record_payment_v1"]) {
    const body = migration.match(new RegExp(`create or replace function relife\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] || "";
    assert.match(body, /organization_id = p_organization_id\s*\n\s*and clinic_id = p_clinic_id/, fn);
    assert.match(body, /PATIENT_NOT_FOUND/, fn);
  }
  assert.match(migration, /constraint appointments_patient_fk foreign key \(organization_id, clinic_id, patient_id\)/);
  assert.match(migration, /constraint payments_patient_fk foreign key \(organization_id, clinic_id, patient_id\)/);
});

test("the same local patient id in two clinics is two different patients", () => {
  assert.match(migration, /primary key \(organization_id, clinic_id, patient_id\)/);
  // Nothing may make a bare patient_id globally unique, which would be the
  // collision that stops a second clinic from ever reaching PT-0001.
  assert.doesNotMatch(migration, /unique\s*\(\s*patient_id\s*\)/);
  assert.doesNotMatch(migration, /create unique index[^;]*on relife\.patients \(patient_id\)/);
});

test("Relife keeps the Sheets path untouched", () => {
  // The legacy writers are still present and still reached for a Sheets clinic:
  // the wiring adds a branch above them, it does not replace them.
  assert.match(serialRegistration, /const workbook = workbookForDepartment\(department\)/);
  assert.match(reception, /appendEntityWithAudit\(/);
  assert.match(payments, /const marker = `WEBREQ:\$\{requestId\}`/);
  // And no path dual-writes: the native branch returns before the Sheets code.
  for (const [name, source] of WIRED_PATHS) {
    assert.doesNotMatch(source, /dual|writeBoth|mirrorTo/i, name);
  }
});

test("the migration neither migrates nor deletes any existing data", () => {
  assert.doesNotMatch(migration, /delete\s+from/i);
  assert.doesNotMatch(migration, /drop table/i);
  assert.doesNotMatch(migration, /truncate/i);
  // An `update` inside a writer function is runtime behaviour, not a data
  // migration, so only statements outside the function bodies count here.
  const migrationTime = migration.replace(/as \$\$[\s\S]*?\$\$;/g, "");
  const updates = migrationTime.match(/update relife\.\w+/g) || [];
  // The only pre-existing rows it touches are the routing switch it just added.
  assert.deepEqual([...new Set(updates)], ["update relife.clinic_settings"]);
});

test("the adapter forwards only supplied fields so an omitted key is not an erase", () => {
  const fn = adapter.match(/export async function updatePatientProfileRow[\s\S]*?\n\}/)?.[0] || "";
  assert.match(fn, /value !== undefined/);
  const sql = migration.match(/create or replace function relife\.update_patient_profile_v1[\s\S]*?\n\$\$;/)?.[0] || "";
  // `?` distinguishes "key absent" from "key present but empty", which is the
  // difference between leaving a phone alone and clearing it.
  assert.match(sql, /p_payload \? 'fullName'/);
  assert.match(sql, /p_payload \? 'phone'/);
});
