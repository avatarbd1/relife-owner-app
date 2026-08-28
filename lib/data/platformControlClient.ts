import "server-only";

import type { PlatformOwnerSnapshot } from "@/lib/data/platformOwner";

const DEFAULT_PLATFORM_CONTROL_URL =
  "https://zpixvkfvmqzhmdacsezj.supabase.co/functions/v1/relife-platform-control";
const PLATFORM_CONTROL_TIMEOUT_MS = 10000;
const HIDDEN_PROOF_ORGANIZATION_PREFIXES = ["phase-g-", "phase-h-"] as const;

function platformControlSecret(): string {
  const secret = String(
    process.env.RELIFE_TENANT_CONTEXT_SECRET ||
      process.env.RELIFE_MUTATION_LOCK_SECRET ||
      "",
  ).trim();
  if (!secret) throw new Error("PLATFORM_CONTROL_SECRET_MISSING");
  return secret;
}

function platformControlUrl(): string {
  const explicit = String(process.env.RELIFE_PLATFORM_CONTROL_URL || "").trim();
  if (explicit) return explicit;
  const base = String(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  ).trim().replace(/\/$/, "");
  return base ? `${base}/functions/v1/relife-platform-control` : DEFAULT_PLATFORM_CONTROL_URL;
}

function operationalPlatformSnapshot(snapshot: PlatformOwnerSnapshot): PlatformOwnerSnapshot {
  return {
    ...snapshot,
    clinics: snapshot.clinics.filter((clinic) =>
      !HIDDEN_PROOF_ORGANIZATION_PREFIXES.some((prefix) =>
        clinic.organizationSlug.startsWith(prefix),
      ),
    ),
  };
}

export async function callPlatformControl<T>(body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLATFORM_CONTROL_TIMEOUT_MS);
  try {
    const response = await fetch(platformControlUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relife-lock-key": platformControlSecret(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: unknown;
    } & T;
    if (!response.ok || payload.ok !== true) {
      throw new Error(String(payload.error || `PLATFORM_CONTROL_HTTP_${response.status}`));
    }
    const payloadRecord = payload as Record<string, unknown>;
    const snapshot = payloadRecord.snapshot as PlatformOwnerSnapshot | undefined;
    if (snapshot && Array.isArray(snapshot.clinics)) {
      payloadRecord.snapshot = operationalPlatformSnapshot(snapshot);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("PLATFORM_CONTROL_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
