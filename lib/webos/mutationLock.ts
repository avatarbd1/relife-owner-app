import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  resolveLockStrategy,
  withDistributedLeaseLock,
  type DistributedLockRpcClient,
} from "./mutationLockCore";

const mutationLocks = new Map<string, Promise<void>>();

const DISTRIBUTED_LOCK_MODE = process.env.DISTRIBUTED_LOCK_MODE ?? "required";
const PROCESS_LOCAL_FALLBACK_ENABLED =
  process.env.ENABLE_PROCESS_LOCAL_LOCK_FALLBACK === "true";
const LOCK_ACQUISITION_TIMEOUT_MS = 30000;
const LOCK_LEASE_SECONDS = 120;

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function getInstanceId(): string {
  return process.env.INSTANCE_ID || `render-${randomUUID()}`;
}

function asLockRpcClient(supabase: SupabaseClient): DistributedLockRpcClient {
  return {
    async rpc(method, params) {
      const { data, error } = await supabase.rpc(method, params);
      return {
        data,
        error: error ? { message: error.message } : null,
      };
    },
  };
}

/**
 * Serialize read-check-write mutations against Google Sheets.
 *
 * required (default): Supabase/Postgres lease lock is mandatory and failures
 * fail closed. compatibility: process-local fallback is available only when
 * explicitly enabled for local/test/single-instance operation.
 */
export async function withMutationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) return fn();

  const supabase = getSupabaseClient();
  const strategy = resolveLockStrategy(
    DISTRIBUTED_LOCK_MODE,
    PROCESS_LOCAL_FALLBACK_ENABLED,
    Boolean(supabase)
  );

  if (strategy === "distributed" && supabase) {
    try {
      return await withDistributedLeaseLock(normalizedKey, fn, asLockRpcClient(supabase), {
        instanceId: getInstanceId(),
        leaseSeconds: LOCK_LEASE_SECONDS,
        acquisitionTimeoutMs: LOCK_ACQUISITION_TIMEOUT_MS,
        randomId: randomUUID,
        onRenewalError: (error) => {
          console.error("Distributed mutation lock renewal warning:", error);
        },
        onReleaseError: (error) => {
          console.error("Distributed mutation lock release warning:", error);
        },
      });
    } catch (error) {
      if (
        DISTRIBUTED_LOCK_MODE === "compatibility" &&
        PROCESS_LOCAL_FALLBACK_ENABLED
      ) {
        console.warn(
          "Distributed lock failed in compatibility mode, falling back to process-local:",
          error
        );
        return withProcessLocalLock(normalizedKey, fn);
      }
      throw error;
    }
  }

  return withProcessLocalLock(normalizedKey, fn);
}

async function withProcessLocalLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = mutationLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  mutationLocks.set(key, current);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (mutationLocks.get(key) === current) {
      mutationLocks.delete(key);
    }
  }
}
