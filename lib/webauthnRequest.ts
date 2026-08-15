import "server-only";

import type { NextRequest } from "next/server";
import { webauthnConfig } from "@/lib/webauthn";

function firstForwardedValue(value: string | null): string {
  return (value || "").split(",")[0]?.trim() || "";
}

export function isAllowedWebAuthnRequestOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  try {
    const actualOrigin = new URL(originHeader).origin;
    const configuredOrigin = new URL(webauthnConfig().origin).origin;
    if (actualOrigin === configuredOrigin) return true;

    // Render terminates TLS in front of the Node process. In that setup
    // request.nextUrl can reflect an internal host while the browser sends
    // the public app origin. Trust only Render/proxy forwarded host+proto,
    // never an arbitrary client body/cookie value.
    const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
    const forwardedProto =
      firstForwardedValue(request.headers.get("x-forwarded-proto")) || "https";

    return Boolean(
      forwardedHost && actualOrigin === `${forwardedProto}://${forwardedHost}`
    );
  } catch {
    return false;
  }
}
