import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Gamification adapter prefers a dedicated edge secret without breaking shared edge auth", () => {
  const adapter = source("lib/data/supabaseGamification.ts");

  assert.match(adapter, /RELIFE_GAMIFICATION_EDGE_SECRET/);
  assert.match(adapter, /RELIFE_EDGE_SECRET/);
  assert.match(
    adapter,
    /process\.env\.RELIFE_GAMIFICATION_EDGE_SECRET \|\|[\s\S]*process\.env\.RELIFE_EDGE_SECRET/
  );
  assert.match(adapter, /GAMIFICATION_EDGE_SECRET_MISSING/);
  assert.match(adapter, /gamificationSupabaseConfigured\(\)/);
});

test("Gamification edge accepts the dedicated secret during migration and retains old shared-secret compatibility", () => {
  const edge = source("supabase/functions/relife-gamification-api/index.ts");

  assert.match(edge, /const SERVER_KEY_HASHES = new Set\(\[/);
  assert.match(
    edge,
    /50840a8a74de86a912cb2a268ff6d24b2a9fc3cf4ab016229e52d3219a3772fe/
  );
  assert.match(
    edge,
    /340a6b07dbfe883d2ecad82971bb4226a32974c00e89138ad71e8279a89e58d2/
  );
  assert.match(edge, /SERVER_KEY_HASHES\.has\(await sha256Hex\(key\)\)/);
});

test("Gamification adapter keeps the production edge URL explicit and server-only", () => {
  const adapter = source("lib/data/supabaseGamification.ts");

  assert.match(adapter, /^import "server-only";/);
  assert.match(adapter, /RELIFE_SUPABASE_GAMIFICATION_EDGE_URL/);
  assert.match(
    adapter,
    /https:\/\/zpixvkfvmqzhmdacsezj\.supabase\.co\/functions\/v1\/relife-gamification-api/
  );
  assert.doesNotMatch(adapter, /NEXT_PUBLIC_.*SECRET/);
});
