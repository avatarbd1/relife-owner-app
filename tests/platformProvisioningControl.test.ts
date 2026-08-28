import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DiagnosticCategory,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from "typescript";

// Issue #231 regression contract: the normal clinic onboarding path must stay
// template-driven and must never require manual slug entry.
const edge = readFileSync(
  new URL("../supabase/functions/relife-platform-control/index.ts", import.meta.url),
  "utf8",
);
const consoleSource = readFileSync(
  new URL("../components/platform/PlatformOwnerConsole.tsx", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../app/api/platform/clinics/route.ts", import.meta.url),
  "utf8",
);
const ownerDepartmentMigration = readFileSync(
  new URL("../supabase/migrations/20260828160000_owner_department_scope.sql", import.meta.url),
  "utf8",
);

test("tracked Platform Control Edge source is valid TypeScript syntax", () => {
  const result = transpileModule(edge, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, []);
});

test("platform provisioning edge keeps the protected server-to-server boundary", () => {
  assert.match(edge, /x-relife-lock-key/);
  assert.match(edge, /SERVER_KEY_HASHES/);
  assert.match(edge, /crypto\.subtle\.digest\("SHA-256"/);
});

test("platform provisioning edge regenerates safe identity defaults before DB provisioning", () => {
  assert.match(edge, /function slugifyPlatformName/);
  assert.match(edge, /function generateOwnerStaffId/);
  assert.match(edge, /const organizationSlug = slugifyPlatformName/);
  assert.match(edge, /const clinicSlug = slugifyPlatformName/);
  assert.match(edge, /text\(raw\.ownerStaffId\) \|\| generateOwnerStaffId/);
  assert.match(edge, /PLAN_CODES\.has\(text\(raw\.planCode\)\) \? text\(raw\.planCode\) : "starter"/);
});

test("automatic slugs and generated owner IDs are allocated collision-safely at the edge", () => {
  assert.match(edge, /async function uniqueOrganizationSlug/);
  assert.match(edge, /async function uniqueClinicSlug/);
  assert.match(edge, /async function uniqueOwnerStaffId/);
  assert.match(edge, /suffixedSlug\(base, serial\)/);
  assert.match(edge, /staff_tenant_bindings where staff_id like/);
  assert.match(edge, /input\.organizationSlug = await uniqueOrganizationSlug/);
  assert.match(edge, /input\.clinicSlug = await uniqueClinicSlug/);
  assert.match(edge, /input\.ownerStaffId = await uniqueOwnerStaffId/);
});

test("API preserves omitted generated fields so the edge can allocate globally unique final values", () => {
  assert.match(routeSource, /explicitOwnerStaffId/);
  assert.match(routeSource, /organizationSlug: String\(raw\.organizationSlug \|\| ""\)\.trim\(\) \|\| undefined/);
  assert.match(routeSource, /clinicSlug: String\(raw\.clinicSlug \|\| ""\)\.trim\(\) \|\| undefined/);
  assert.match(routeSource, /ownerStaffId: explicitOwnerStaffId \|\| undefined/);
});

test("platform control sends a structured JSON parameter to the canonical provisioner", () => {
  assert.match(edge, /provision_clinic_v1\(\$\{sql\.json\(payload\)\}::jsonb\)/);
  assert.doesNotMatch(edge, /JSON\.stringify\(payload\).*::jsonb/);
});

test("the platform template stays Physio-neutral and no second clinic type is selectable", () => {
  const templateFn = edge.match(
    /function templateForClinicType\([\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(templateFn, /serviceDepartment: "Physio"/);
  assert.match(templateFn, /rooms: \[\]/);
  assert.match(templateFn, /resources: \[\]/);
  assert.match(templateFn, /bookingMode: "simple"/);
  assert.match(templateFn, /resourceRequired: false/);
  assert.doesNotMatch(templateFn, /Treatment Room|Treatment Bed|Relife/i);

  assert.match(edge, /CLINIC_TYPES = new Set\(\["physiotherapy"\]\)/);
  assert.doesNotMatch(edge, /"dental"|"doctor_chamber"|DENTAL_CHAIR|Dental Room|Dental Chair/i);
  assert.doesNotMatch(edge, /Relife Dental|relife-dental|amtali-main/);
});

test("owner department scope follows tenant configuration without rewriting legacy rows", () => {
  assert.match(ownerDepartmentMigration, /owner_department_scope_for_binding/);
  assert.match(ownerDepartmentMigration, /sv\.department in \('Physio', 'Dental'\)/);
  assert.match(ownerDepartmentMigration, /if v_clinic_type = 'physiotherapy' then\s+return 'Physio'/);
  assert.match(ownerDepartmentMigration, /if v_clinic_type = 'dental' then\s+return 'Dental'/);
  assert.match(ownerDepartmentMigration, /if coalesce\(array_length\(v_departments, 1\), 0\) > 1 then\s+return 'All'/);
  assert.match(ownerDepartmentMigration, /before insert or update of department_id/);
  assert.match(ownerDepartmentMigration, /role_code = 'owner'/);
  assert.doesNotMatch(ownerDepartmentMigration, /update\s+relife\.staff_tenant_departments\s+set/i);
  assert.doesNotMatch(ownerDepartmentMigration, /amtali-main|3222b282-bc98-4721-9db1-196cd6d94647|bc77ffb9-3379-40cc-a1eb-89b0e988fe94/i);
});

test("new clinic handoff exposes the generated tenant-scoped owner setup link", () => {
  assert.match(routeSource, /ownerSetupUrl/);
  assert.match(consoleSource, /ownerSetupUrl/);
  assert.match(consoleSource, /Clinic created\. Owner setup is ready\./);
  assert.match(consoleSource, /Open owner setup/);
});

test("existing clinic cards can request a fresh read-only owner setup handoff", () => {
  assert.match(routeSource, /owner_setup_link/);
  assert.match(routeSource, /PLATFORM_CLINIC_OWNER_AMBIGUOUS/);
  assert.match(consoleSource, /Generate owner setup link/);
  assert.match(consoleSource, /Regenerate owner setup link/);
  assert.match(consoleSource, /expires in 10 minutes/);
});

test("the Platform Owner console offers exactly one clinic template", () => {
  assert.match(consoleSource, /CLINIC_TYPES: Array<\{ value: ClinicType; label: string \}> = \[\s*\{ value: "physiotherapy", label: "Physiotherapy" \},\s*\];/);
  assert.doesNotMatch(consoleSource, /"dental"|"doctor_chamber"/);
});

test("Add new clinic UI does not ask the platform owner to type slugs", () => {
  assert.match(consoleSource, /Create clinic from template/);
  assert.match(consoleSource, /Slug:/);
  assert.match(consoleSource, /slugifyPlatformName\(clinicName\)/);
  assert.doesNotMatch(consoleSource, /placeholder="organization-slug"/);
  assert.doesNotMatch(consoleSource, /placeholder="clinic-slug"/);
});
