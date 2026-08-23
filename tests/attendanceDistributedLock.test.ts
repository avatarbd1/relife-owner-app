import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("all attendance mutations share one distributed staff/day lock", () => {
  const attendance = source("lib/webos/attendance.ts");
  const normal = source("lib/webos/attendanceNormal.ts");

  assert.match(
    attendance,
    /return `attendance:\$\{staffId\.trim\(\)\}:\$\{date\.trim\(\)\}`/
  );
  assert.match(attendance, /return withMutationLock\(lockKey, async \(\) =>/);
  assert.match(normal, /return withMutationLock\(lockKey, async \(\) =>/);
  assert.match(normal, /attendanceMutationLockKey\(context\.staffId, now\.date\)/);
});

test("attendance writers contain no process-local lock registry", () => {
  const attendance = source("lib/webos/attendance.ts");
  const normal = source("lib/webos/attendanceNormal.ts");

  assert.doesNotMatch(attendance, /actionLocks|withStaffDateLock/);
  assert.doesNotMatch(normal, /checkInLocks|withCheckInLock/);
});

test("distributed lock core remains fail-closed in production", () => {
  const lock = source("lib/webos/mutationLock.ts");
  assert.match(lock, /DISTRIBUTED_LOCK_MODE = process\.env\.DISTRIBUTED_LOCK_MODE \?\? "required"/);
  assert.match(lock, /ENABLE_PROCESS_LOCAL_LOCK_FALLBACK === "true"/);
  assert.match(lock, /DISTRIBUTED_LOCK_MODE === "compatibility"/);
});

test("compatibility fallback never replays a business callback error", () => {
  const lock = source("lib/webos/mutationLock.ts");
  assert.match(lock, /class MutationCallbackError extends Error/);
  assert.match(lock, /throw new MutationCallbackError\(error\)/);
  assert.match(lock, /if \(error instanceof MutationCallbackError\) \{\s*throw error\.original;\s*\}/s);
  const businessRethrow = lock.indexOf("if (error instanceof MutationCallbackError)");
  const compatibilityFallback = lock.indexOf('DISTRIBUTED_LOCK_MODE === "compatibility"', businessRethrow);
  assert.ok(businessRethrow >= 0 && compatibilityFallback > businessRethrow);
});
