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

test("platform control sends a native JSON parameter to the canonical provisioner", () => {
  assert.match(edge, /provision_clinic_v1\(\$\{sql\.json\(payload\)\}\)/);
  assert.doesNotMatch(edge, /JSON\.stringify\(payload\).*::jsonb/);
});

test("clinic type templates create editable starter configuration without clinic-specific branches", () => {
  assert.match(edge, /Treatment Room 1/);
  assert.match(edge, /Treatment Bed 1/);
  assert.match(edge, /Dental Room 1/);
  assert.match(edge, /Dental Chair 1/);
  assert.match(edge, /Editable starter template/);
  assert.doesNotMatch(edge, /Relife Dental|relife-dental|amtali-main/);
});

test("Add new clinic UI does not ask the platform owner to type slugs", () => {
  assert.match(consoleSource, /Create clinic from template/);
  assert.match(consoleSource, /Slug:/);
  assert.match(consoleSource, /slugifyPlatformName\(clinicName\)/);
  assert.doesNotMatch(consoleSource, /placeholder="organization-slug"/);
  assert.doesNotMatch(consoleSource, /placeholder="clinic-slug"/);
});
