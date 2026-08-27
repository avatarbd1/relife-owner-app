import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireCurrentTenantAccessContext, type CurrentTenantAccessContext } from "@/lib/webos/currentUser";

/**
 * T2-02: Middleware that validates tenant context for all critical operational routes.
 * Use this in handler functions that mutate patient, appointment, clinical, or financial data.
 *
 * Example usage:
 *   const context = await requireTenantContext(request);
 *   if (!context.ok) return context.error;
 *   // Use context.data (CurrentTenantAccessContext)
 */
export async function requireTenantContext(
  _request: NextRequest,
  operation?: string
): Promise<{ ok: true; data: CurrentTenantAccessContext } | { ok: false; error: NextResponse }> {
  try {
    const context = await requireCurrentTenantAccessContext();
    if (!context) {
      return {
        ok: false,
        error: NextResponse.json(
          { ok: false, error: "ACCESS_DENIED", operation: operation || "unknown" },
          { status: 403 }
        ),
      };
    }
    return { ok: true, data: context };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TENANT_CONTEXT_FAILED";
    const statusCode = message.includes("TENANT") || message.includes("ACCESS") ? 403 : 503;
    return {
      ok: false,
      error: NextResponse.json(
        { ok: false, error: message, operation: operation || "unknown" },
        { status: statusCode }
      ),
    };
  }
}

/**
 * Error handler for tenant-aware routes.
 * Distinguishes authorization errors (403) from operational/schema errors.
 */
export function tenantErrorResponse(error: unknown, context?: { operation?: string }): NextResponse {
  const message = error instanceof Error ? error.message : "OPERATION_FAILED";

  // Tenant/access errors
  if (message.includes("TENANT") || message.includes("ACCESS_DENIED") || message.includes("DEPARTMENT_ACCESS")) {
    return NextResponse.json(
      { ok: false, error: message, operation: context?.operation },
      { status: 403 }
    );
  }

  // Not found
  if (message.includes("NOT_FOUND")) {
    return NextResponse.json(
      { ok: false, error: message, operation: context?.operation },
      { status: 404 }
    );
  }

  // Conflict
  if (message.includes("CONFLICT") || message.includes("DUPLICATE")) {
    return NextResponse.json(
      { ok: false, error: message, operation: context?.operation },
      { status: 409 }
    );
  }

  // Bad request
  if (message.startsWith("INVALID_")) {
    return NextResponse.json(
      { ok: false, error: message, operation: context?.operation },
      { status: 400 }
    );
  }

  // Schema/infrastructure
  if (message.includes("SCHEMA") || message.includes("MISMATCH") || message.includes("SECRET")) {
    return NextResponse.json(
      { ok: false, error: message, operation: context?.operation },
      { status: 503 }
    );
  }

  console.error("Operation failed:", message);
  return NextResponse.json(
    { ok: false, error: message, operation: context?.operation },
    { status: 500 }
  );
}
