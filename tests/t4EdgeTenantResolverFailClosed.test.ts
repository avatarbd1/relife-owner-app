import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const privilegedTenantEdges = [
  "supabase/functions/relife-finance-api/index.ts",
  "supabase/functions/relife-appointment-api/index.ts",
  "supabase/functions/relife-chamber-api/index.ts",
  "supabase/functions/relife-chamber-runtime-api/index.ts",
  "supabase/functions/relife-gamification-api/index.ts",
  "supabase/functions/relife-reward-claims-api/index.ts",
  "supabase/functions/relife-weekly-gamification-finalizer/index.ts",
] as const;

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("privileged tenant Edges require explicit organization and clinic slugs", () => {
  for (const path of privilegedTenantEdges) {
    const edge = source(path);

    assert.doesNotMatch(
      edge,
      /DEFAULT_ORGANIZATION_SLUG|DEFAULT_CLINIC_SLUG/,
      `${path} must not carry a silent Tenant #1 fallback`
    );
    assert.doesNotMatch(
      edge,
      /body\.organizationSlug\s*\|\||body\.clinicSlug\s*\|\|/,
      `${path} must not default omitted tenant input`
    );
    assert.match(
      edge,
      /const organizationSlug\s*=\s*norm\(body\.organizationSlug\)/,
      `${path} must read organizationSlug explicitly`
    );
    assert.match(
      edge,
      /const clinicSlug\s*=\s*norm\(body\.clinicSlug\)/,
      `${path} must read clinicSlug explicitly`
    );
    assert.match(
      edge,
      /if\s*\(\s*!organizationSlug\s*\|\|\s*!clinicSlug\s*\)\s*throw new Error\("TENANT_SCOPE_REQUIRED"\)/,
      `${path} must fail closed before tenant lookup`
    );
  }
});
