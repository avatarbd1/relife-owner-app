import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260828170000_physio_only_template_relife_conversion.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Relife converts to a single-department Physiotherapy tenant without deleting Dental history", () => {
  assert.match(migration, /where o\.slug = 'relife' and c\.slug = 'amtali-main'/);
  assert.match(migration, /clinic_type = 'physiotherapy'/);
  assert.match(migration, /on conflict \(organization_id, clinic_id\) do update/);

  // Archival, never deletion.
  assert.doesNotMatch(migration, /delete\s+from/i);
  assert.match(migration, /update relife\.clinic_services[\s\S]*?is_active = false[\s\S]*?department = 'Dental'/);
  assert.match(migration, /update relife\.clinic_resources[\s\S]*?is_active = false[\s\S]*?resource_type = 'DENTAL_CHAIR'/);
});

test("the clinic_type constraint is narrowed to the single physiotherapy template", () => {
  assert.match(migration, /add constraint clinic_settings_clinic_type_check check \(clinic_type in \('physiotherapy'\)\)/);
});
