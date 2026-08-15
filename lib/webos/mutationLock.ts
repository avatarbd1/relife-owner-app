import "server-only";

const mutationLocks = new Map<string, Promise<void>>();

/**
 * Serialize mutations that must perform a read-check-write sequence against
 * Google Sheets. This protects the current single-instance Render deployment
 * from duplicate/capacity races. It is intentionally process-local; if the web
 * service is ever scaled above one instance, replace this with a distributed
 * lock or a datastore-enforced uniqueness constraint before scaling.
 */
export async function withMutationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) return fn();

  const previous = mutationLocks.get(normalizedKey) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  mutationLocks.set(normalizedKey, current);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (mutationLocks.get(normalizedKey) === current) {
      mutationLocks.delete(normalizedKey);
    }
  }
}
