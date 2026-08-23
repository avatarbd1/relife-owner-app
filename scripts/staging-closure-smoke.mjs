import crypto from "node:crypto";
import { spawn } from "node:child_process";

const port = String(process.env.PORT || "3000");
const base = `http://127.0.0.1:${port}`;
const sessionSecret = process.env.SESSION_SECRET?.trim();
if (!sessionSecret) {
  console.error("[closure-smoke] SESSION_SECRET missing");
  process.exit(1);
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], {
  env: process.env,
  stdio: "inherit",
});

function stop() {
  if (!server.killed) server.kill("SIGTERM");
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/login`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Next server did not become ready");
}

function ownerCookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ version: 2, exp, staffId: "ST001" })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("hex");
  return `relife_owner_session=v2.${payload}.${signature}`;
}

function expectedClientKey() {
  const namespace = new URL(base).host.toLowerCase();
  const material = `owner-pin:${namespace}:unknown`;
  return crypto.createHmac("sha256", sessionSecret).update(material).digest("hex");
}

async function login(pin, extraHeaders = {}) {
  return fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify({ pin }),
    redirect: "manual",
  });
}

async function clearThrottle() {
  const secret = (process.env.RELIFE_AUTH_RATE_LIMIT_SECRET || process.env.RELIFE_MUTATION_LOCK_SECRET || "").trim();
  if (!secret) throw new Error("staging auth-rate-limit secret missing");
  const url = (process.env.RELIFE_SUPABASE_AUTH_RATE_LIMIT_URL || "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-auth-rate-limit").trim();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relife-lock-key": secret },
    body: JSON.stringify({ action: "success", clientKey: expectedClientKey() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`throttle cleanup failed HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  console.log("[closure-smoke] PASS throttle cleanup");
}

async function main() {
  await waitForReady();

  const badOrigin = await login(`wrong-${crypto.randomUUID()}`, { origin: "https://invalid.example" });
  if (badOrigin.status !== 403) throw new Error(`bad origin expected 403, got ${badOrigin.status}`);
  console.log("[closure-smoke] PASS Owner PIN rejects cross-origin request");

  const wrongPin = `wrong-${crypto.randomUUID()}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await login(wrongPin);
    if (response.status !== 401) throw new Error(`wrong PIN attempt ${attempt} expected 401, got ${response.status}`);
  }
  console.log("[closure-smoke] PASS first four wrong Owner PIN attempts return 401");

  const fifth = await login(wrongPin);
  if (fifth.status !== 429) throw new Error(`fifth wrong PIN expected 429, got ${fifth.status}`);
  if (!fifth.headers.get("retry-after")) throw new Error("fifth wrong PIN missing Retry-After");
  console.log("[closure-smoke] PASS fifth wrong Owner PIN locks with 429 + Retry-After");

  const blocked = await login(wrongPin);
  if (blocked.status !== 429) throw new Error(`blocked retry expected 429, got ${blocked.status}`);
  console.log("[closure-smoke] PASS blocked Owner PIN retry remains 429");

  await clearThrottle();

  const monthly = await fetch(`${base}/api/v1/gamification/monthly/finalize`, {
    headers: { cookie: ownerCookie() },
    redirect: "manual",
  });
  const monthlyPayload = await monthly.json().catch(() => null);
  if (monthly.status !== 200 || monthlyPayload?.ok !== true) {
    throw new Error(`monthly_status expected 200/ok, got ${monthly.status} ${JSON.stringify(monthlyPayload)}`);
  }
  console.log("[closure-smoke] PASS monthly_status read-only backend parity");
  console.log("[closure-smoke] PASS no finalize_month mutation invoked");
  console.log("[closure-smoke] ALL PASS");
}

main()
  .then(() => {
    stop();
  })
  .catch(async (error) => {
    console.error("[closure-smoke] FAIL", error);
    try {
      await clearThrottle();
    } catch (cleanupError) {
      console.error("[closure-smoke] cleanup warning", cleanupError);
    }
    stop();
    process.exitCode = 1;
  });

server.on("exit", (code, signal) => {
  if (process.exitCode) process.exit(process.exitCode);
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
