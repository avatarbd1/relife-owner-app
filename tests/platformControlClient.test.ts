import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("platform control uses protected server-to-server edge boundary", async () => {
  const client = await source("lib/data/platformControlClient.ts");
  assert.match(client, /RELIFE_TENANT_CONTEXT_SECRET/);
  assert.match(client, /RELIFE_MUTATION_LOCK_SECRET/);
  assert.match(client, /x-relife-lock-key/);
  assert.match(client, /relife-platform-control/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("platform control hides Phase G/H proof tenants from operational snapshots", async () => {
  const client = await source("lib/data/platformControlClient.ts");
  assert.match(client, /HIDDEN_PROOF_ORGANIZATION_PREFIXES/);
  assert.match(client, /phase-g-/);
  assert.match(client, /phase-h-/);
  assert.match(client, /snapshot\.clinics\.filter/);
  assert.match(client, /operationalPlatformSnapshot/);
});

test("Platform Owner page and API avoid Render-side Supabase admin dependency", async () => {
  const [page, route] = await Promise.all([
    source("app/platform/page.tsx"),
    source("app/api/platform/clinics/route.ts"),
  ]);
  for (const content of [page, route]) {
    assert.match(content, /callPlatformControl/);
    assert.doesNotMatch(content, /createSupabaseAdminClient/);
    assert.doesNotMatch(content, /listPlatformOwnerSnapshot/);
  }
  assert.match(page, /no clinic tenant binding/);
  assert.match(route, /PLATFORM_OWNER_CANNOT_BE_CLINIC_OWNER/);
});
