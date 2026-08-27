import "server-only";

import { randomUUID } from "node:crypto";

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
const LOCK_EDGE_TIMEOUT_MS = 8000;
const DEFAULT_LOCK_EDGE_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-mutation-lock";

type EdgePayload = {
  data?: unknown;
  error?: { message?: unknown } | null;
};

class MutationCallbackError extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super("MUTATION_CALLBACK_ERROR");
    this.name = "MutationCallbackError";
    this.original = original;
  }
}

function getInstanceId(): string {
  return process.env.INSTANCE_ID || `render-${randomUUID()}`;
}

function getLockRpcClient(): DistributedLockRpcClient | null {
  const secret = process.env.RELIFE_MUTATION_LOCK_SECRET?.trim();
  const url = (
    process.env.RELIFE_SUPABASE_MUTATION_LOCK_URL || DEFAULT_LOCK_EDGE_URL
  ).trim();
  if (!secret || !url) return null;

  return {
    async rpc(method, params) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LOCK_EDGE_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-relife-lock-key": secret,
          },
          body: JSON.stringify({ method, params }),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as EdgePayload;
        const message = String(
          payload.error?.message || `HTTP ${response.status}`
        );
        if (!response.ok) {
          return { data: null, error: { message } };
        }
        return {
          data: payload.data,
          error: payload.error ? { message } : null,
        };
      } catch (error) {
        return {
          data: null,
          error: {
            message:
              error instanceof Error
                ? error.message
                : "DISTRIBUTED_LOCK_EDGE_UNAVAILABLE",
          },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Serialize read-check-write mutations against Google Sheets.
 *
 * required (default): Supabase/Postgres lease lock via a server-authenticated
 * Edge Function is mandatory and failures fail closed. compatibility:
 * process-local fallback is available only when explicitly enabled for
 * local/test/single-instance operation.
 *
 * A callback/business error must never be treated as lock-infrastructure
 * failure. In compatibility mode only acquisition/transport failures may
 * fall back to the process-local lock; replaying a failed callback could
 * duplicate a mutation or turn an intentional ACCESS_DENIED/409 into a
 * second write attempt.
 */
export async function withMutationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) return fn();

  const client = getLockRpcClient();
  const strategy = resolveLockStrategy(
    DISTRIBUTED_LOCK_MODE,
    PROCESS_LOCAL_FALLBACK_ENABLED,
    Boolean(client)
  );

  if (strategy === "distributed" && client) {
    try {
      return await withDistributedLeaseLock(
        normalizedKey,
        async () => {
          try {
            return await fn();
          } catch (error) {
            throw new MutationCallbackError(error);
          }
        },
        client,
        {
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
        }
      );
    } catch (error) {
      if (error instanceof MutationCallbackError) {
        throw error.original;
      }
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
