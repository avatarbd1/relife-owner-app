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
  assert.match(page, /Staff \/ passkey/);
  assert.match(page, /Owner PIN/);
  assert.match(page, /Registered staff devices can use the biometric\/passkey button/);
});

test("owner PIN cookie remains HttpOnly and same-site", () => {
  const route = source("app/api/login/route.ts");
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /sameSite:\s*"lax"/);
  assert.match(route, /secure:\s*process\.env\.NODE_ENV === "production"/);
});
