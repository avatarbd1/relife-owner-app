import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260828020000_phase_h_repeatable_provisioning.sql", import.meta.url),
  "utf8",
);
const master = readFileSync(
  new URL("../docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md", import.meta.url),
  "utf8",
);

test("Phase H generic provisioner accepts ordinary facility differences as data", () => {
  assert.match(migration, /p_payload->'rooms'/);
  assert.match(migration, /p_payload->'resources'/);
  assert.match(migration, /jsonb_array_elements\(v_rooms\)/);
  assert.match(migration, /jsonb_array_elements\(v_resources\)/);
  assert.match(migration, /relife\.clinic_rooms/);
  assert.match(migration, /relife\.clinic_resources/);
});

test("Phase H keeps booking and service differences configuration-driven", () => {
  assert.match(migration, /v_booking->>'mode'/);
  assert.match(migration, /v_booking->>'maxSimultaneous'/);
  assert.match(migration, /v_booking->>'resourceRequired'/);
  assert.match(migration, /r->>'price'/);
  assert.match(migration, /r->>'durationMin'/);
  assert.match(migration, /r->>'requiresResource'/);
});

test("Phase H removes Phase G-specific commercial plan hard-coding", () => {
  assert.match(migration, /commercial,planCode/);
  assert.doesNotMatch(migration, /phase-g-proof/);
  assert.match(migration, /'canonical provisioning'/);
});

test("Phase H provisioning authority remains service-role-only and fail-closed", () => {
  assert.match(
    migration,
    /revoke all on function relife\.provision_clinic_v1\(jsonb\) from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function relife\.provision_clinic_v1\(jsonb\) to service_role/i,
  );
  assert.match(migration, /PROVISIONING_INVALID_PAYLOAD_SHAPE/);
  assert.match(migration, /PROVISIONING_UNKNOWN_FEATURE/);
  assert.match(migration, /PROVISIONING_INVALID_RESOURCE/);
});

test("master contract defines Phase H as Clinics 3-5 repeatability before 6-20 rollout", () => {
  assert.match(master, /Phase H — Repeatability/);
  assert.match(master, /Clinics #3-#5/);
  assert.match(master, /Clinics #6-#20/);
  assert.match(master, /no source-code changes required for ordinary configuration differences/i);
});
