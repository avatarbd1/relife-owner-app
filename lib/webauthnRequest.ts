import "server-only";

import type { NextRequest } from "next/server";
import { webauthnConfig } from "@/lib/webauthn";

function firstForwardedValue(value: string | null): string {
  return (value || "").split(",")[0]?.trim() || "";
}

/**
 * Validate browser same-origin requests when Next.js is running behind a
 * trusted reverse proxy such as Render. `request.nextUrl.host` can reflect
 * the internal Node host, so prefer the public Origin and proxy-forwarded
 * host/proto values instead of comparing against nextUrl.host directly.
 */
export function isAllowedRequestOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  // Some non-browser/same-site requests legitimately omit Origin. Existing
  // authenticated route handlers may allow those and rely on the session.
  if (!originHeader) return true;

  try {
    const actualOrigin = new URL(originHeader).origin;

    // The configured production origin is an explicit trusted fallback and
    // also covers deployments where the proxy does not forward the host.
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

    // Local development / direct Node access fallback. This is checked only
    // after the explicit configured and forwarded public origins above.
    const host = firstForwardedValue(request.headers.get("host"));
    if (host && actualOrigin === `${request.nextUrl.protocol}//${host}`) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export const isAllowedWebAuthnRequestOrigin = isAllowedRequestOrigin;
