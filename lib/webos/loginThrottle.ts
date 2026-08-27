import "server-only";

import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

const DEFAULT_AUTH_RATE_LIMIT_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-auth-rate-limit";
const EDGE_TIMEOUT_MS = 5000;

export type OwnerLoginThrottleState = {
  allowed: boolean;
  blocked: boolean;
  retryAfterSeconds: number;
  remainingAttempts: number;
};

type EdgePayload = Partial<OwnerLoginThrottleState> & {
  ok?: boolean;
  error?: unknown;
};

function authSecret(): string {
  const secret = (
    process.env.RELIFE_AUTH_RATE_LIMIT_SECRET ||
    process.env.RELIFE_MUTATION_LOCK_SECRET ||
    ""
  ).trim();
  if (!secret) throw new Error("AUTH_RATE_LIMIT_SECRET_MISSING");
  return secret;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
  return secret;
}

function sourceAddress(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const firstForwarded = forwarded.split(",")[0]?.trim();
  return firstForwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function ownerLoginClientKey(request: NextRequest): string {
  const namespace =
    process.env.RENDER_SERVICE_ID?.trim() ||
    request.headers.get("x-forwarded-host")?.trim().toLowerCase() ||
    request.headers.get("host")?.trim().toLowerCase() ||
    process.env.NODE_ENV ||
    "relife-owner";
  const material = `owner-pin:${namespace}:${sourceAddress(request)}`;
  return createHmac("sha256", sessionSecret()).update(material).digest("hex");
}

async function command(
  action: "reserve" | "failure" | "success",
  clientKey: string
): Promise<OwnerLoginThrottleState> {
  const url = (
    process.env.RELIFE_SUPABASE_AUTH_RATE_LIMIT_URL ||
    DEFAULT_AUTH_RATE_LIMIT_URL
  ).trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-lock-key": authSecret(),
      },
      body: JSON.stringify({ action, clientKey }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as EdgePayload;
    if (!response.ok || payload.ok !== true) {
      throw new Error(String(payload.error || `AUTH_RATE_LIMIT_HTTP_${response.status}`));
    }
    return {
      allowed: payload.allowed === true,
      blocked: payload.blocked === true,
      retryAfterSeconds: Math.max(0, Number(payload.retryAfterSeconds || 0)),
      remainingAttempts: Math.max(0, Number(payload.remainingAttempts || 0)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function reserveOwnerLoginAttempt(clientKey: string) {
  return command("reserve", clientKey);
}

export function recordOwnerLoginFailure(clientKey: string) {
  return command("failure", clientKey);
}

export function clearOwnerLoginThrottle(clientKey: string) {
  return command("success", clientKey);
}
