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
