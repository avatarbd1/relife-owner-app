import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  lockBackoffMs,
  resolveLockStrategy,
  withDistributedLeaseLock,
  type DistributedLockRpcClient,
} from "../lib/webos/mutationLockCore.ts";

type FakeLock = {
  ownerId: string;
  token: string;
  expiresAt: number;
  status: "active" | "released";
};

class FakeLockClient implements DistributedLockRpcClient {
  private locks = new Map<string, FakeLock>();
  private tokenCounter = 0;
  private acquireOwners = new Map<string, Set<string>>();
  renewCalls = 0;
  failAcquireMessage = "";
  rejectRenewal = false;

  async rpc(method: string, params: Record<string, unknown>) {
    if (method === "acquire_distributed_lock") return this.acquire(params);
    if (method === "renew_distributed_lock") return this.renew(params);
    if (method === "release_distributed_lock") return this.release(params);
    return { data: null, error: { message: `unknown RPC ${method}` } };
  }

  private acquire(params: Record<string, unknown>) {
    if (this.failAcquireMessage) {
      return { data: null, error: { message: this.failAcquireMessage } };
    }

    const key = String(params.p_lock_key);
    const ownerId = String(params.p_owner_id);
    const timeoutSeconds = Number(params.p_timeout_seconds);
    const owners = this.acquireOwners.get(key) ?? new Set<string>();
    owners.add(ownerId);
    this.acquireOwners.set(key, owners);

    const now = Date.now();
    const existing = this.locks.get(key);
    if (!existing || existing.status === "released" || existing.expiresAt <= now) {
      const token = `token-${++this.tokenCounter}`;
      this.locks.set(key, {
        ownerId,
        token,
        expiresAt: now + timeoutSeconds * 1000,
        status: "active",
      });
      return {
        data: {
          lock_key: key,
          owner_id: ownerId,
          token,
          acquired_by_caller: true,
          is_expired: false,
          status: "active",
        },
        error: null,
      };
    }

    return {
      data: {
        lock_key: key,
        owner_id: existing.ownerId,
        token: existing.token,
        acquired_by_caller: false,
        is_expired: false,
        status: existing.status,
      },
      error: null,
    };
  }

  private renew(params: Record<string, unknown>) {
    this.renewCalls += 1;
    if (this.rejectRenewal) {
      return { data: { renewed: false }, error: null };
    }

    const key = String(params.p_lock_key);
    const ownerId = String(params.p_owner_id);
    const token = String(params.p_token);
    const timeoutSeconds = Number(params.p_timeout_seconds);
    const lock = this.locks.get(key);
    const now = Date.now();

    if (
      lock &&
      lock.status === "active" &&
      lock.ownerId === ownerId &&
      lock.token === token &&
      lock.expiresAt > now
    ) {
      lock.expiresAt = now + timeoutSeconds * 1000;
      return { data: { renewed: true }, error: null };
    }

    return { data: { renewed: false }, error: null };
  }

  private release(params: Record<string, unknown>) {
    const key = String(params.p_lock_key);
    const ownerId = String(params.p_owner_id);
    const token = String(params.p_token);
    const lock = this.locks.get(key);

    if (
      lock &&
      lock.status === "active" &&
      lock.ownerId === ownerId &&
      lock.token === token
    ) {
      lock.status = "released";
      return { data: true, error: null };
    }

    return { data: false, error: null };
  }

  expire(key: string) {
    const lock = this.locks.get(key);
    if (lock) lock.expiresAt = Date.now() - 1;
  }

  hold(key: string) {
    this.locks.set(key, {
      ownerId: "other-owner",
      token: "other-token",
      expiresAt: Date.now() + 60_000,
      status: "active",
    });
  }

  ownersFor(key: string): Set<string> {
    return this.acquireOwners.get(key) ?? new Set<string>();
  }
}

function options(instanceId: string, randomId: string) {
  return {
    instanceId,
    randomId: () => randomId,
    leaseSeconds: 5,
    acquisitionTimeoutMs: 1000,
    renewalIntervalMs: 20,
  };
}

describe("distributed mutation lock core", () => {
  it("required mode fails closed without a distributed client", () => {
    assert.throws(
      () => resolveLockStrategy("required", false, false),
      /Supabase not configured/
    );
    assert.equal(resolveLockStrategy("required", false, true), "distributed");
  });

  it("compatibility fallback requires explicit opt-in", () => {
    assert.throws(
      () => resolveLockStrategy("compatibility", false, false),
      /ENABLE_PROCESS_LOCAL_LOCK_FALLBACK/
    );
    assert.equal(resolveLockStrategy("compatibility", true, false), "process-local");
    assert.equal(resolveLockStrategy("compatibility", true, true), "distributed");
  });

  it("fails closed when the acquire RPC returns an error", async () => {
    const client = new FakeLockClient();
    client.failAcquireMessage = "database unavailable";
    await assert.rejects(
      withDistributedLeaseLock("finance:test", async () => undefined, client, options("i1", "a")),
      /database unavailable/
    );
  });

  it("uses bounded exponential backoff", () => {
    assert.equal(lockBackoffMs(0), 100);
    assert.ok(lockBackoffMs(1) > lockBackoffMs(0));
    assert.equal(lockBackoffMs(100), 5000);
  });

  it("serializes same-key operations", async () => {
    const client = new FakeLockClient();
    const order: string[] = [];

    const first = withDistributedLeaseLock(
      "finance:same",
      async () => {
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push("first-end");
      },
      client,
      options("instance", "first")
    );

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = withDistributedLeaseLock(
      "finance:same",
      async () => {
        order.push("second-start");
        order.push("second-end");
      },
      client,
      options("instance", "second")
    );

    await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "first-end", "second-start", "second-end"]);
  });

  it("allows different keys to execute concurrently", async () => {
    const client = new FakeLockClient();
    const order: string[] = [];

    const first = withDistributedLeaseLock(
      "finance:key-a",
      async () => {
        order.push("a-start");
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push("a-end");
      },
      client,
      options("instance", "a")
    );
    const second = withDistributedLeaseLock(
      "finance:key-b",
      async () => {
        order.push("b-start");
        order.push("b-end");
      },
      client,
      options("instance", "b")
    );

    await Promise.all([first, second]);
    assert.ok(order.indexOf("b-start") < order.indexOf("a-end"));
  });

  it("releases the lock when the protected callback throws", async () => {
    const client = new FakeLockClient();
    await assert.rejects(
      withDistributedLeaseLock(
        "finance:error",
        async () => {
          throw new Error("callback failed");
        },
        client,
        options("instance", "one")
      ),
      /callback failed/
    );

    let ran = false;
    await withDistributedLeaseLock(
      "finance:error",
      async () => {
        ran = true;
      },
      client,
      options("instance", "two")
    );
    assert.equal(ran, true);
  });

  it("uses a unique owner identity for concurrent calls from one instance", async () => {
    const client = new FakeLockClient();
    const first = withDistributedLeaseLock(
      "finance:owner",
      async () => new Promise((resolve) => setTimeout(resolve, 30)),
      client,
      options("same-instance", "owner-a")
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = withDistributedLeaseLock(
      "finance:owner",
      async () => undefined,
      client,
      options("same-instance", "owner-b")
    );

    await Promise.all([first, second]);
    assert.equal(client.ownersFor("finance:owner").size, 2);
  });

  it("rejects release attempts with the wrong token", async () => {
    const client = new FakeLockClient();
    await withDistributedLeaseLock(
      "finance:token",
      async () => {
        const result = await client.rpc("release_distributed_lock", {
          p_lock_key: "finance:token",
          p_owner_id: "wrong-owner",
          p_token: "wrong-token",
        });
        assert.equal(result.data, false);
      },
      client,
      options("instance", "token-owner")
    );
  });

  it("recovers an expired stale lease", async () => {
    const client = new FakeLockClient();
    await client.rpc("acquire_distributed_lock", {
      p_lock_key: "finance:stale",
      p_owner_id: "crashed-owner",
      p_timeout_seconds: 5,
    });
    client.expire("finance:stale");

    let acquired = false;
    await withDistributedLeaseLock(
      "finance:stale",
      async () => {
        acquired = true;
      },
      client,
      options("recovery", "new-owner")
    );
    assert.equal(acquired, true);
  });

  it("does not steal an unexpired lease", async () => {
    const client = new FakeLockClient();
    const order: string[] = [];
    const first = withDistributedLeaseLock(
      "finance:protected",
      async () => {
        order.push("holder");
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
      client,
      options("instance-a", "a")
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = withDistributedLeaseLock(
      "finance:protected",
      async () => {
        order.push("waiter");
      },
      client,
      options("instance-b", "b")
    );

    await Promise.all([first, second]);
    assert.deepEqual(order, ["holder", "waiter"]);
  });

  it("times out instead of retrying forever", async () => {
    const client = new FakeLockClient();
    client.hold("finance:deadline");
    await assert.rejects(
      withDistributedLeaseLock(
        "finance:deadline",
        async () => undefined,
        client,
        {
          instanceId: "waiter",
          randomId: () => "deadline",
          leaseSeconds: 5,
          acquisitionTimeoutMs: 15,
          renewalIntervalMs: 10,
        }
      ),
      /within 15ms deadline/
    );
  });

  it("renews a long-running lease and reports rejected renewals", async () => {
    const client = new FakeLockClient();
    await withDistributedLeaseLock(
      "finance:renew",
      async () => new Promise((resolve) => setTimeout(resolve, 35)),
      client,
      options("instance", "renew")
    );
    assert.ok(client.renewCalls >= 1);

    const warnings: Error[] = [];
    client.rejectRenewal = true;
    await withDistributedLeaseLock(
      "finance:renew-rejected",
      async () => new Promise((resolve) => setTimeout(resolve, 35)),
      client,
      {
        ...options("instance", "renew-rejected"),
        onRenewalError: (error) => warnings.push(error),
      }
    );
    assert.ok(warnings.length >= 1);
  });

  it("migration keeps lock RPCs server-only and rejects expired renewal", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20260817_distributed_mutation_lock.sql", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(sql, /create\s+policy/i);
    assert.match(
      sql,
      /revoke all on table public\.distributed_mutation_lock from public, anon, authenticated/i
    );
    assert.match(
      sql,
      /grant execute on function public\.acquire_distributed_lock\(text, text, int\) to service_role/i
    );
    assert.match(sql, /and expires_at > pg_catalog\.now\(\)/i);
  });
});
