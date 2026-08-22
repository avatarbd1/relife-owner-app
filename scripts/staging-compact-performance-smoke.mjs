import crypto from "node:crypto";
import { spawn } from "node:child_process";

const port = String(process.env.PORT || "3000");
const base = `http://127.0.0.1:${port}`;
const sessionSecret = process.env.SESSION_SECRET?.trim();

if (!sessionSecret) {
  console.error("[compact-smoke] SESSION_SECRET missing");
  process.exit(1);
}

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", port],
  { env: process.env, stdio: "inherit" }
);

function stop(signal = "SIGTERM") {
  if (!server.killed) server.kill(signal);
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

async function waitForReady() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/login`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error("Next server did not become ready");
}

function smokeCookie(staffId) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const claims = { version: 2, exp, staffId };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("hex");
  return `relife_owner_session=v2.${payload}.${signature}`;
}

const blockedMarkers = [
  "LIVE DATA UNAVAILABLE",
  "Clinic data could not be loaded safely",
  "This page couldn’t load",
  "This page couldn't load",
];

async function checkPage(path, cookie, requiredMarkers = []) {
  const response = await fetch(`${base}${path}`, {
    headers: { cookie },
    redirect: "manual",
  });
  const text = await response.text();
  if (response.status !== 200) throw new Error(`${path} returned HTTP ${response.status}`);
  for (const marker of blockedMarkers) {
    if (text.toLowerCase().includes(marker.toLowerCase())) {
      throw new Error(`${path} rendered blocked marker: ${marker}`);
    }
  }
  for (const marker of requiredMarkers) {
    if (!text.includes(marker)) throw new Error(`${path} missing expected marker: ${marker}`);
  }
  console.log(`[compact-smoke] PASS ${path}`);
}

try {
  await waitForReady();
  const ownerCookie = smokeCookie("ST001");
  const receptionistCookie = smokeCookie("ST004");

  await checkPage("/home", ownerCookie, ["Owner workspace"]);
  await checkPage("/finance", ownerCookie, ["Finance"]);
  await checkPage("/performance", receptionistCookie, [
    "performance-gamified-wrap",
    "Weekly normalized score",
    "Lifetime XP",
    "My Missions",
    "Leaderboard",
    "Rewards",
    "Milestones",
    "Rules &amp; details",
  ]);

  console.log("[compact-smoke] ALL PASS");
} catch (error) {
  console.error("[compact-smoke] FAIL", error);
  stop("SIGTERM");
  process.exit(1);
}

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
