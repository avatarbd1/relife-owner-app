import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("PIN endpoint remains owner-only authentication", () => {
  const route = source("app/api/login/route.ts");
  assert.match(route, /checkOwnerPin\(pin\)/);
  assert.match(route, /createSessionToken\(\)/);
  assert.doesNotMatch(route, /staffId\s*:/);
  assert.doesNotMatch(route, /role\s*:/);
});

test("staff sign-in remains passkey\/biometric based rather than per-staff PIN", () => {
  const page = source("app/login/page.tsx");
  assert.match(page, /<BiometricLogin/);
  assert.match(page, /Staff access/);
  assert.match(page, /Fingerprint \/ Face ID/);
  assert.match(page, /Owner access/);
  assert.doesNotMatch(page, /Staff PIN/);
});

test("owner PIN cookie remains HttpOnly and same-site", () => {
  const route = source("app/api/login/route.ts");
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /sameSite:\s*"lax"/);
  assert.match(route, /secure:\s*process\.env\.NODE_ENV === "production"/);
});

test("owner PIN route is same-origin and durably rate limited before PIN comparison", () => {
  const route = source("app/api/login/route.ts");
  const adapter = source("lib/webos/loginThrottle.ts");
  const edge = source("supabase/functions/relife-auth-rate-limit/index.ts");
  const migration = source("supabase/migrations/20260823103000_owner_login_throttle.sql");

  assert.match(route, /isAllowedRequestOrigin\(request\)/);
  assert.match(route, /reserveOwnerLoginAttempt\(clientKey\)/);
  assert.match(route, /recordOwnerLoginFailure\(clientKey\)/);
  assert.match(route, /clearOwnerLoginThrottle\(clientKey\)/);
  assert.match(route, /status:\s*429/);
  assert.ok(
    route.indexOf("reserveOwnerLoginAttempt(clientKey)") <
      route.indexOf("checkOwnerPin(pin)")
  );

  assert.match(adapter, /createHmac\("sha256", sessionSecret\(\)\)/);
  assert.match(adapter, /RELIFE_MUTATION_LOCK_SECRET/);
  assert.doesNotMatch(adapter, /new Map|new Set/);

  assert.match(edge, /MAX_ATTEMPTS = 5/);
  assert.match(edge, /WINDOW_SECONDS = 15 \* 60/);
  assert.match(edge, /LOCK_SECONDS = 15 \* 60/);
  assert.match(edge, /pg_advisory_xact_lock/);
  assert.match(edge, /action === "reserve"/);
  assert.match(edge, /action === "failure"/);
  assert.match(edge, /delete from relife\.owner_login_throttle/);

  assert.match(migration, /create table if not exists relife\.owner_login_throttle/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from public, anon, authenticated/);
});
