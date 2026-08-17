import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const mutationLocks = new Map<string, Promise<void>>();

type SupabaseClientType = SupabaseClient;

function getSupabaseClient(): SupabaseClientType | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function getInstanceId(): string {
  return process.env.INSTANCE_ID || `render-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Serialize mutations that must perform a read-check-write sequence against
 * Google Sheets. Hybrid approach:
 * - Primary: Distributed lock via Supabase (multi-instance safe)
 * - Fallback: Process-local Map (single-instance fast path, or if Supabase unavailable)
 *
 * Google Sheets mutations happen outside DB transaction, so we use a lease-based
 * distributed lock with timeout/expiry for safety.
 */
export async function withMutationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) return fn();

  const supabase = getSupabaseClient();
  const instanceId = getInstanceId();

  // Try distributed lock first (multi-instance safe)
  if (supabase) {
    return await withDistributedLock(normalizedKey, instanceId, fn, supabase);
  }

  // Fallback to process-local lock (single-instance or degraded mode)
  return await withProcessLocalLock(normalizedKey, fn);
}

async function withDistributedLock<T>(
  key: string,
  instanceId: string,
  fn: () => Promise<T>,
  supabase: SupabaseClientType
): Promise<T> {
  const lockTimeout = 30; // seconds
  let lockToken: string | null = null;

  try {
    // Attempt to acquire distributed lock
    const { data, error: acquireError } = await supabase.rpc("acquire_distributed_lock", {
      p_lock_key: key,
      p_owner_id: instanceId,
      p_timeout_seconds: lockTimeout,
    });

    if (acquireError) {
      console.warn("Distributed lock acquire failed, falling back to process-local:", acquireError);
      return await withProcessLocalLock(key, fn);
    }

    if (!data?.acquired_by_caller) {
      // Lock held by another instance, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 100));
      return await withDistributedLock(key, instanceId, fn, supabase);
    }

    lockToken = data.token;

    // Execute function under lock
    try {
      return await fn();
    } finally {
      // Release lock
      if (lockToken) {
        const { error: releaseError } = await supabase.rpc("release_distributed_lock", {
          p_lock_key: key,
          p_owner_id: instanceId,
          p_token: lockToken,
        });
        if (releaseError) {
          console.error("Failed to release distributed lock:", releaseError);
        }
      }
    }
  } catch (error) {
    console.error("Distributed lock error, falling back to process-local:", error);
    return await withProcessLocalLock(key, fn);
  }
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
