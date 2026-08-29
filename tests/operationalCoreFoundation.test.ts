import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  displayTimeFromMinute,
  minuteFromDisplayTime,
  minuteFromInputTime,
} from "../lib/domain/operations/appointmentTime.ts";
import {
  isOperationalStore,
  resolveOperationalStore,
  usesTenantNativeOperationalCore,
} from "../lib/domain/tenancy/operationalStore.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260829090000_operational_core_foundation.sql", import.meta.url),
  "utf8",
);
const adapter = readFileSync(
  new URL("../lib/data/supabaseOperational.ts", import.meta.url),
  "utf8",
);
const configWriter = readFileSync(
  new URL("../lib/data/clinicConfiguration.ts", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("operational store routing fails closed instead of guessing an authority", () => {
  assert.equal(resolveOperationalStore("sheets"), "sheets");
  assert.equal(resolveOperationalStore("supabase"), "supabase");

  // An unconfigured or unknown clinic must not silently fall back: pointing a
  // live clinic at the wrong store is either lost writes or an empty screen.
  for (const bad of [undefined, null, "", "sheet", "postgres", "SUPABASE", 1, {}]) {
    assert.throws(() => resolveOperationalStore(bad), /OPERATIONAL_STORE_NOT_CONFIGURED/, String(bad));
  }
  assert.equal(isOperationalStore("supabase"), true);
  assert.equal(isOperationalStore("mysql"), false);
});

test("tenant-native routing is a store decision, never a clinic identity check", () => {
  assert.equal(usesTenantNativeOperationalCore("supabase"), true);
  assert.equal(usesTenantNativeOperationalCore("sheets"), false);

  const routing = readFileSync(
    new URL("../lib/domain/tenancy/operationalStore.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(routing, /relife|amtali|RELIFE|PHYSIO|DENTAL/);
});

// ---------------------------------------------------------------------------
// Schema guarantees
// ---------------------------------------------------------------------------

test("every operational table is tenant-scoped with a composite clinic foreign key", () => {
  for (const table of ["patients", "appointments", "payments", "clinic_local_id_sequences"]) {
    const body = migration.match(
      new RegExp(`create table if not exists relife\\.${table} \\([\\s\\S]*?\\n\\);`),
    )?.[0];
    assert.ok(body, `${table} must be created`);
    assert.match(body, /organization_id uuid not null/, table);
    assert.match(body, /clinic_id uuid not null/, table);
    assert.match(
      body,
      /foreign key \(organization_id, clinic_id\)\s*\n\s*references relife\.clinics \(organization_id, id\)/,
      table,
    );
  }
});

test("business keys are clinic-local so two clinics may reuse the same id series", () => {
  // The whole point: PT-0001 belongs to a clinic, not to the platform.
  assert.match(migration, /primary key \(organization_id, clinic_id, patient_id\)/);
  assert.match(migration, /primary key \(organization_id, clinic_id, appointment_id\)/);
  assert.match(migration, /primary key \(organization_id, clinic_id, receipt_no\)/);

  // A child row can only ever point at a patient inside the same clinic.
  for (const fk of ["appointments_patient_fk", "payments_patient_fk"]) {
    assert.match(
      migration,
      new RegExp(`constraint ${fk} foreign key \\(organization_id, clinic_id, patient_id\\)`),
      fk,
    );
  }
});

test("every mutation is idempotent through a per-clinic request id", () => {
  for (const index of ["patients_request_uidx", "appointments_request_uidx", "payments_request_uidx"]) {
    assert.match(
      migration,
      new RegExp(`create unique index if not exists ${index}[\\s\\S]*?where request_id <> ''`),
      index,
    );
  }
  // The writers refuse an unmarked mutation rather than accepting one that
  // could not be recognised on retry.
  assert.equal((migration.match(/REQUEST_ID_REQUIRED/g) || []).length, 3);
});

test("clinic-local id allocation is race-free rather than a max+1 scan", () => {
  const fn = migration.match(/create or replace function relife\.next_clinic_local_id[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(fn, /on conflict \(organization_id, clinic_id, sequence_kind\) do update/);
  assert.match(fn, /returning next_value - 1/);
  assert.doesNotMatch(fn, /max\(/i);
});

test("the operational core carries no Dental department and no fixed Relife identity", () => {
  for (const table of ["patients", "appointments", "payments"]) {
    const body = migration.match(
      new RegExp(`create table if not exists relife\\.${table} \\([\\s\\S]*?\\n\\);`),
    )?.[0] || "";
    assert.match(body, /check \(department in \('Physio'\)\)/, table);
  }
  // Prose explaining why the legacy ledger identities are being left behind is
  // fine; what must not appear is one of them used as an actual value.
  const executable = migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(executable, /RELIFE-PHYSIO|RELIFE-DENTAL|'RELIFE'/);
});

test("Relife keeps its existing Sheets authority and new clinics get the native core", () => {
  assert.match(migration, /add column if not exists operational_store text not null default 'supabase'/);
  assert.match(migration, /check \(operational_store in \('sheets', 'supabase'\)\)/);
  // Relife is pinned explicitly; this migration must not move its live data.
  assert.match(migration, /set operational_store = 'sheets'[\s\S]*?o\.slug = 'relife' and c\.slug = 'amtali-main'/);
  assert.doesNotMatch(migration, /delete\s+from/i);
});

test("browser roles are denied on operational tables and only the server path is granted", () => {
  const rls = migration.match(/operational_tables text\[\] := array\[[\s\S]*?end\n\$\$;/)?.[0] || "";
  for (const table of ["'patients'", "'appointments'", "'payments'", "'clinic_local_id_sequences'"]) {
    assert.ok(rls.includes(table), table);
  }
  assert.match(rls, /enable row level security/);
  assert.match(rls, /revoke all on table relife\.%I from anon, authenticated/);
  assert.match(rls, /to service_role/);
});

test("privileged writers re-check tenant scope because service_role bypasses RLS", () => {
  for (const fn of ["register_patient_v1", "book_appointment_v1", "record_payment_v1"]) {
    const body = migration.match(new RegExp(`create or replace function relife\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] || "";
    assert.ok(body, fn);
    assert.match(body, /TENANT_SCOPE_REQUIRED/, fn);
    assert.match(body, /security definer/, fn);
    assert.match(body, /set search_path = relife, pg_catalog/, fn);
    // Every writer records its own audit event in the same transaction.
    assert.match(body, /insert into relife\.audit_events/, fn);
  }
  assert.match(migration, /revoke all on function %s from public, anon, authenticated/);
});

test("a payment commits its receipt, the patient balance and the audit together", () => {
  const fn = migration.match(/create or replace function relife\.record_payment_v1[\s\S]*?\n\$\$;/)?.[0] || "";
  assert.match(fn, /insert into relife\.payments/);
  assert.match(fn, /update relife\.patients/);
  assert.match(fn, /insert into relife\.audit_events/);
  // Accounting meaning stays in the finance domain; the writer stores the
  // outcome it was handed rather than reinterpreting it.
  assert.match(fn, /decided by the finance domain/);
});

test("cross-clinic booking and payment are rejected inside the writer", () => {
  for (const fn of ["book_appointment_v1", "record_payment_v1"]) {
    const body = migration.match(new RegExp(`create or replace function relife\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] || "";
    assert.match(body, /from relife\.patients[\s\S]*?organization_id = p_organization_id[\s\S]*?clinic_id = p_clinic_id/, fn);
    assert.match(body, /PATIENT_NOT_FOUND/, fn);
  }
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

test("the adapter scopes every read to the resolved tenant", () => {
  for (const reader of ["readPatients", "readPatient", "readAppointments", "readPayments"]) {
    const body = adapter.match(new RegExp(`export async function ${reader}\\([\\s\\S]*?\\n\\}`))?.[0] || "";
    assert.ok(body, reader);
    assert.match(body, /requireTenantScope\(scope\)/, reader);
    assert.match(body, /dbScope\(tenant\)/, reader);
  }
});

test("the adapter stores records and never decides policy", () => {
  // No permission checks, no accounting, no booking safety: those belong to the
  // domain layer and must not be re-implemented behind persistence.
  assert.doesNotMatch(adapter, /canPerform|assertCanPerform|WebAction/);
  assert.doesNotMatch(adapter, /RELIFE|amtali-main|workbookForDepartment/);
});

test("business rejections keep their contract instead of becoming storage errors", () => {
  assert.match(adapter, /DUPLICATE_PHONE/);
  assert.match(adapter, /APPOINTMENT_DUPLICATE/);
  assert.match(adapter, /PATIENT_NOT_FOUND/);
});

test("a clinic settings edit can never repoint the clinic at another store", () => {
  assert.match(
    configWriter,
    /Omit<ClinicProfileConfiguration, keyof TenantScope \| "lifecycle" \| "operationalStore">/,
  );
  assert.doesNotMatch(configWriter, /operational_store:/);
});

// ---------------------------------------------------------------------------
// Time conversion
// ---------------------------------------------------------------------------

test("appointment times survive the round trip between storage and display", () => {
  assert.equal(displayTimeFromMinute(0), "12:00 AM");
  assert.equal(displayTimeFromMinute(9 * 60), "9:00 AM");
  assert.equal(displayTimeFromMinute(12 * 60), "12:00 PM");
  assert.equal(displayTimeFromMinute(13 * 60 + 30), "1:30 PM");
  assert.equal(displayTimeFromMinute(23 * 60 + 59), "11:59 PM");

  assert.equal(minuteFromInputTime("00:00"), 0);
  assert.equal(minuteFromInputTime("09:30"), 570);
  assert.equal(minuteFromInputTime("23:59"), 1439);
  for (const bad of ["", "9", "24:00", "09:60", "9:5", "abc"]) {
    assert.throws(() => minuteFromInputTime(bad), /INVALID_TIME/, bad);
  }

  // Reading a display value back must land on the same minute it came from,
  // including the two noon/midnight cases where 12-hour clocks usually break.
  for (const minute of [0, 1, 570, 719, 720, 721, 1080, 1439]) {
    assert.equal(minuteFromDisplayTime(displayTimeFromMinute(minute)), minute, String(minute));
  }
  for (const bad of ["", "13:00 PM", "0:30 AM", "9:60 AM", "9:30", "abc"]) {
    assert.throws(() => minuteFromDisplayTime(bad), /INVALID_TIME/, bad);
  }
});
