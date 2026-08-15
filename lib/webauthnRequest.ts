import "server-only";

import type { NextRequest } from "next/server";
import { webauthnConfig } from "@/lib/webauthn";

function firstForwardedValue(value: string | null): string {
  return (value || "").split(",")[0]?.trim() || "";
}

function matchesTrustedOrigin(request: NextRequest, originHeader: string): boolean {
  try {
    const actualOrigin = new URL(originHeader).origin;
    const configuredOrigin = new URL(webauthnConfig().origin).origin;
    if (actualOrigin === configuredOrigin) return true;

    const forwardedHost = firstForwardedValue(
      request.headers.get("x-forwarded-host")
    );
    const forwardedProto =
      firstForwardedValue(request.headers.get("x-forwarded-proto")) || "https";

    if (
      forwardedHost &&
      actualOrigin === `${forwardedProto}://${forwardedHost}`
    ) {
      return true;
    }

    const host = firstForwardedValue(request.headers.get("host"));
    if (host && actualOrigin === `${request.nextUrl.protocol}//${host}`) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Same-origin guard for authenticated application write routes. Some
 * non-browser requests omit Origin, so those continue to rely on session /
 * route authorization. Browser requests must match a trusted public origin.
 */
export function isAllowedRequestOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return true;
  return matchesTrustedOrigin(request, originHeader);
}

/** WebAuthn operations always require an explicit trusted Origin header. */
export function isAllowedWebAuthnRequestOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;
  return matchesTrustedOrigin(request, originHeader);
}
