import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("mutation lock Edge transport", () => {
  it("keeps the Supabase service-role credential out of the Render lock client", () => {
    const client = source("../lib/webos/mutationLock.ts");
    assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(client, /createClient\s*\(/);
    assert.match(client, /RELIFE_MUTATION_LOCK_SECRET/);
    assert.match(client, /x-relife-lock-key/);
    assert.match(client, /relife-mutation-lock/);
  });

  it("Edge transport whitelists only lock RPCs and owns the service-role client", () => {
    const edge = source("../supabase/functions/relife-mutation-lock/index.ts");
    assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(edge, /x-relife-lock-key/);
    assert.match(edge, /acquire_distributed_lock/);
    assert.match(edge, /renew_distributed_lock/);
    assert.match(edge, /release_distributed_lock/);
    assert.match(edge, /METHODS\.has\(method\)/);
    assert.match(edge, /INVALID_LOCK_METHOD/);
    assert.doesNotMatch(edge, /cleanup_expired_locks/);
  });
});
