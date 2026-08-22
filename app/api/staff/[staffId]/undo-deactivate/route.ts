import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { undoManagedStaffDeactivate } from "@/lib/webos/staffUndo";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "STAFF_UNDO_FAILED";
  if (message === "ACCESS_DENIED" || message === "OWNER_PROFILE_IMMUTABLE") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "STAFF_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
  if (message === "STAFF_UNDO_CONFLICT") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (message === "STAFF_SCHEMA_MISMATCH") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if ([
    "STAFF_ID_REQUIRED",
    "INVALID_STAFF_ROLE",
    "INVALID_STAFF_DEPARTMENT",
    "INVALID_STAFF_DEPARTMENT_ACCESS",
    "PRIMARY_DEPARTMENT_OUTSIDE_ACCESS",
    "THERAPIST_DEPARTMENT_INVALID",
    "DENTAL_ROLE_DEPARTMENT_INVALID",
  ].includes(message)) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("Staff deactivate undo API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> }
) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }
  try {
    const [context, routeParams, body] = await Promise.all([
      requireCurrentAccessContext(),
      params,
      request.json().catch(() => null),
    ]);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const result = await undoManagedStaffDeactivate(context, {
      staffId: decodeURIComponent(routeParams.staffId),
      expectedProfile: body.expectedProfile,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
