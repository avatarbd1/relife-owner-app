export type LockRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

export interface DistributedLockRpcClient {
  rpc(method: string, params: Record<string, unknown>): Promise<LockRpcResult>;
}

export type LockStrategy = "distributed" | "process-local";

export type DistributedLockOptions = {
  instanceId: string;
  leaseSeconds?: number;
  acquisitionTimeoutMs?: number;
  renewalIntervalMs?: number;
  randomId?: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRenewalError?: (error: Error) => void;
  onReleaseError?: (error: Error) => void;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolveLockStrategy(
  mode: string,
  processLocalFallbackEnabled: boolean,
  hasDistributedClient: boolean
): LockStrategy {
  if (mode === "required") {
    if (!hasDistributedClient) {
      throw new Error(
        "DISTRIBUTED_LOCK_MODE=required but Supabase not configured through the distributed lock service. " +
          "Set RELIFE_MUTATION_LOCK_SECRET or use DISTRIBUTED_LOCK_MODE=compatibility"
      );
    }
    return "distributed";
  }

  if (mode !== "compatibility") {
    throw new Error(`Unsupported DISTRIBUTED_LOCK_MODE '${mode}'.`);
  }

  if (hasDistributedClient) return "distributed";

  if (!processLocalFallbackEnabled) {
    throw new Error(
      "ENABLE_PROCESS_LOCAL_LOCK_FALLBACK not set. " +
        "For compatibility mode, set ENABLE_PROCESS_LOCAL_LOCK_FALLBACK=true and DISTRIBUTED_LOCK_MODE=compatibility"
    );
  }

  return "process-local";
}

export function lockBackoffMs(retryCount: number): number {
  return Math.min(100 * Math.pow(1.5, retryCount), 5000);
}

export async function withDistributedLeaseLock<T>(
  key: string,
  fn: () => Promise<T>,
  client: DistributedLockRpcClient,
  options: DistributedLockOptions
): Promise<T> {
  const leaseSeconds = options.leaseSeconds ?? 120;
  const acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? 30000;
  const renewalIntervalMs =
    options.renewalIntervalMs ?? Math.max(1000, Math.floor((leaseSeconds * 1000) / 4));
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 18));
  const ownerId = `${options.instanceId}:${randomId()}`;
  const deadline = now() + acquisitionTimeoutMs;
  let retryCount = 0;

  while (now() <= deadline) {
    const { data, error } = await client.rpc("acquire_distributed_lock", {
      p_lock_key: key,
      p_owner_id: ownerId,
      p_timeout_seconds: leaseSeconds,
    });

    if (error) {
      throw new Error(`Distributed lock acquisition failed for key '${key}': ${error.message}`);
    }

    const acquire = asRecord(data);
    if (getBoolean(acquire?.acquired_by_caller) === true) {
      const token = getString(acquire?.token);
      if (!token) {
        throw new Error(`Distributed lock '${key}' was acquired without a token.`);
      }

      let renewalInFlight = false;
      const renewalInterval = setInterval(() => {
        if (renewalInFlight) return;
        renewalInFlight = true;
        void client
          .rpc("renew_distributed_lock", {
            p_lock_key: key,
            p_owner_id: ownerId,
            p_token: token,
            p_timeout_seconds: leaseSeconds,
          })
          .then(({ data: renewalData, error: renewalRpcError }) => {
            if (renewalRpcError) {
              options.onRenewalError?.(
                new Error(`Distributed lock '${key}' renewal failed: ${renewalRpcError.message}`)
              );
              return;
            }
            const renewal = asRecord(renewalData);
            if (getBoolean(renewal?.renewed) !== true) {
              options.onRenewalError?.(
                new Error(`Distributed lock '${key}' renewal was rejected by the lock service.`)
              );
            }
          })
          .catch((renewalError: unknown) => {
            options.onRenewalError?.(
              renewalError instanceof Error ? renewalError : new Error(String(renewalError))
            );
          })
          .finally(() => {
            renewalInFlight = false;
          });
      }, renewalIntervalMs);

      try {
        return await fn();
      } finally {
        clearInterval(renewalInterval);
        try {
          const { data: releaseData, error: releaseRpcError } = await client.rpc(
            "release_distributed_lock",
            {
              p_lock_key: key,
              p_owner_id: ownerId,
              p_token: token,
            }
          );
          if (releaseRpcError) {
            options.onReleaseError?.(
              new Error(`Distributed lock '${key}' release failed: ${releaseRpcError.message}`)
            );
          } else if (releaseData !== true) {
            options.onReleaseError?.(
              new Error(`Distributed lock '${key}' release was rejected by the lock service.`)
            );
          }
        } catch (releaseError: unknown) {
          options.onReleaseError?.(
            releaseError instanceof Error ? releaseError : new Error(String(releaseError))
          );
        }
      }
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(lockBackoffMs(retryCount), remainingMs));
    retryCount += 1;
  }

  throw new Error(
    `Failed to acquire distributed lock for key '${key}' within ${acquisitionTimeoutMs}ms deadline after ${retryCount} retries.`
  );
}
