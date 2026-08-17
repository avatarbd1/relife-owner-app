import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const mutationLocks = new Map<string, Promise<void>>();

type SupabaseClientType = SupabaseClient;

const DISTRIBUTED_LOCK_MODE = process.env.DISTRIBUTED_LOCK_MODE ?? "required";
const PROCESS_LOCAL_FALLBACK_ENABLED =
  process.env.ENABLE_PROCESS_LOCAL_LOCK_FALLBACK === "true";
const LOCK_ACQUISITION_TIMEOUT_MS = 30000; // 30s overall deadline

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
 * Google Sheets.
 *
 * Mode: required (default, production)
 * - Uses distributed Supabase lock (multi-instance safe)
 * - Fails closed if Supabase unavailable or lock acquisition fails
 * - No silent fallback to process-local
 *
 * Mode: compatibility (test/single-instance only)
 * - Requires ENABLE_PROCESS_LOCAL_LOCK_FALLBACK=true
 * - Uses process-local Map with optional Supabase attempt
 * - Only for development/single-instance Render deployment
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

  if (DISTRIBUTED_LOCK_MODE === "required") {
    // Production: distributed lock required, fail closed if unavailable
    if (!supabase) {
      throw new Error(
        "DISTRIBUTED_LOCK_MODE=required but Supabase not configured. " +
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or use DISTRIBUTED_LOCK_MODE=compatibility"
      );
    }
    return await withDistributedLock(normalizedKey, instanceId, fn, supabase);
  }

  // Compatibility mode (tests/local/single-instance only)
  if (!PROCESS_LOCAL_FALLBACK_ENABLED) {
    throw new Error(
      "ENABLE_PROCESS_LOCAL_LOCK_FALLBACK not set. " +
      "For compatibility mode, set ENABLE_PROCESS_LOCAL_LOCK_FALLBACK=true and DISTRIBUTED_LOCK_MODE=compatibility"
    );
  }

  // Try distributed first, fallback to process-local only if explicitly enabled
  if (supabase) {
    try {
      return await withDistributedLock(normalizedKey, instanceId, fn, supabase);
    } catch (error) {
      console.warn("Distributed lock failed in compatibility mode, falling back to process-local:", error);
    }
  }

  return await withProcessLocalLock(normalizedKey, fn);
}

async function withDistributedLock<T>(
  key: string,
  instanceId: string,
  fn: () => Promise<T>,
  supabase: SupabaseClientType
): Promise<T> {
  const lockTimeout = 30; // seconds
  const deadline = Date.now() + LOCK_ACQUISITION_TIMEOUT_MS;
  let lockToken: string | null = null;
  let retryCount = 0;
  const maxRetries = 300; // ~30s with exponential backoff

  while (retryCount < maxRetries) {
    if (Date.now() > deadline) {
      throw new Error(
        `Failed to acquire distributed lock for key '${key}' within ${LOCK_ACQUISITION_TIMEOUT_MS}ms deadline. ` +
        `Retried ${retryCount} times.`
      );
    }

    try {
      // Attempt to acquire distributed lock
      const { data, error: acquireError } = await supabase.rpc("acquire_distributed_lock", {
        p_lock_key: key,
        p_owner_id: instanceId,
        p_timeout_seconds: lockTimeout,
      });

      if (acquireError) {
        throw new Error(`Supabase RPC failed: ${acquireError.message}`);
      }

      if (data?.acquired_by_caller) {
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
      }

      // Lock held by another instance, wait with exponential backoff
      const backoffMs = Math.min(100 * Math.pow(1.5, retryCount), 5000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      retryCount++;
    } catch (error) {
      throw new Error(
        `Distributed lock acquisition failed for key '${key}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new Error(
    `Failed to acquire distributed lock for key '${key}' after ${maxRetries} retries within ${LOCK_ACQUISITION_TIMEOUT_MS}ms.`
  );
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
