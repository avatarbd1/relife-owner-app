import { NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import {
  createManagedStaff,
  listManagedStaff,
  type StaffMutationInput,
} from "@/lib/webos/staffManagement";

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "STAFF_MANAGEMENT_FAILED";
  if (message === "ACCESS_DENIED") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }
  if (message === "STAFF_PHONE_DUPLICATE" || message === "STAFF_ID_COLLISION") {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (message === "STAFF_SCHEMA_MISMATCH" || message === "STAFF_ACCESS_MAPPING_UNAVAILABLE") {
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
  if (
    [
      "STAFF_NAME_REQUIRED",
      "INVALID_STAFF_PHONE",
      "INVALID_STAFF_ROLE",
      "INVALID_STAFF_DEPARTMENT",
      "INVALID_STAFF_DEPARTMENT_ACCESS",
      "PRIMARY_DEPARTMENT_OUTSIDE_ACCESS",
      "THERAPIST_DEPARTMENT_INVALID",
      "DENTAL_ROLE_DEPARTMENT_INVALID",
      "INVALID_STAFF_SALARY",
    ].includes(message)
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  console.error("Staff management API failed", message);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function GET() {
  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const staff = await listManagedStaff(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId
    );
    return NextResponse.json({ ok: true, staff });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  }

  try {
    const tenantContext = await requireCurrentTenantAccessContext();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const result = await createManagedStaff(
      tenantContext.access,
      tenantContext.tenant.organizationId,
      tenantContext.tenant.clinicId,
      body as StaffMutationInput
    );
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
