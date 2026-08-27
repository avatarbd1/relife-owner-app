import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260827060000_t5_clinic_local_keys_and_no_tenant_defaults.sql", import.meta.url),
  "utf8"
);

const foundationalOperationalTables = [
  "appointments",
  "booking_conflicts",
  "chamber_resources",
  "chamber_sessions",
  "chat_messages",
  "equipment_requests",
  "machine_reservations",
  "patient_cache",
  "treatment_plan_cache",
  "treatment_timeline",
] as const;

test("T5 removes silent tenant defaults from foundational operational tables", () => {
  for (const table of foundationalOperationalTables) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /alter column organization_id drop default/i);
  assert.match(migration, /alter column clinic_id drop default/i);
  assert.doesNotMatch(migration, /default_organization_id\s*\(/i);
  assert.doesNotMatch(migration, /default_clinic_id\s*\(/i);
});

test("patient cache identities include both tenant keys", () => {
  assert.match(
    migration,
    /alter table relife\.patient_cache[\s\S]*primary key \(organization_id, clinic_id, patient_id\)/i
  );
  assert.match(
    migration,
    /alter table relife\.treatment_plan_cache[\s\S]*primary key \(organization_id, clinic_id, patient_id\)/i
  );
});

test("Chamber resource identity and dependent foreign keys are tenant-scoped", () => {
  assert.match(
    migration,
    /alter table relife\.chamber_resources[\s\S]*primary key \(organization_id, clinic_id, resource_id\)/i
  );
  for (const table of ["equipment_requests", "machine_reservations"]) {
    assert.match(
      migration,
      new RegExp(
        `alter table relife\\.${table}[\\s\\S]*foreign key \\(organization_id, clinic_id, resource_id\\)[\\s\\S]*references relife\\.chamber_resources \\(organization_id, clinic_id, resource_id\\)`,
        "i"
      )
    );
  }
});
