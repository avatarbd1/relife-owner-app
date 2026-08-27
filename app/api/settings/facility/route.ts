import { NextRequest, NextResponse } from "next/server";
import { readClinicConfiguration, writeFacilityConfiguration } from "@/lib/data/clinicConfiguration";
import { validateBookingConfig, type ClinicBookingConfig, type ClinicResource } from "@/lib/domain/tenancy/clinicConfiguration";
import type { ClinicRoomConfiguration } from "@/lib/domain/tenancy/configurationCore";
import { createBulkFacilityPlan, type BulkRoomResourceInput } from "@/lib/domain/tenancy/facilityConfiguration";
import { validateTenantScope } from "@/lib/domain/tenancy/validators";
import { canPerform } from "@/lib/webos/access";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { isAllowedRequestOrigin } from "@/lib/webauthnRequest";

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "FACILITY_CONFIGURATION_FAILED";
  return NextResponse.json({ ok: false, error: message }, { status: /ACCESS|AUTHORIZED|TENANT_SCOPE/.test(message) ? 403 : /INVALID|REQUIRED/.test(message) ? 400 : 500 });
}

function authorize(context: Awaited<ReturnType<typeof requireCurrentTenantAccessContext>>) {
  validateTenantScope(context.access, context.tenant, "facility.manage");
  if (!canPerform(context.access, "settings.manage", "Physio") && !canPerform(context.access, "settings.manage", "Dental")) throw new Error("CONFIGURATION_NOT_AUTHORIZED");
}

export async function GET() {
  try {
    const context = await requireCurrentTenantAccessContext();
    validateTenantScope(context.access, context.tenant, "facility.read");
    const { rooms, resources, booking } = await readClinicConfiguration(context.tenant);
    return NextResponse.json({ ok: true, facility: { rooms, resources, booking } });
  } catch (error) { return fail(error); }
}

export async function PUT(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentTenantAccessContext(); authorize(context);
    const body = await request.json() as { rooms?: Omit<ClinicRoomConfiguration, "organizationId" | "clinicId">[]; resources?: Omit<ClinicResource, "organizationId" | "clinicId">[]; bulk?: BulkRoomResourceInput; booking?: Omit<ClinicBookingConfig, "organizationId" | "clinicId"> };
    const generated = body.bulk ? createBulkFacilityPlan(context.tenant, body.bulk) : null;
    const rooms = generated?.rooms || body.rooms;
    const resources = generated?.resources || body.resources;
    if (!Array.isArray(rooms) || !Array.isArray(resources) || !body.booking) throw new Error("FACILITY_CONFIGURATION_REQUIRED");
    const codes = new Set(rooms.map((row) => row.roomCode.trim()));
    if (codes.has("") || codes.size !== rooms.length || rooms.some((row) => !row.displayName.trim())) throw new Error("INVALID_ROOMS");
    const resourceCodes = new Set(resources.map((row) => row.resourceCode.trim()));
    const resourceTypes = new Set(["BED", "DENTAL_CHAIR", "TREATMENT_TABLE", "CABIN", "ROOM", "MACHINE", "OTHER"]);
    if (resourceCodes.has("") || resourceCodes.size !== resources.length || resources.some((row) => !row.displayName.trim() || !resourceTypes.has(row.resourceType) || !Number.isInteger(row.capacity) || row.capacity <= 0 || (row.roomCode !== null && !codes.has(row.roomCode)))) throw new Error("INVALID_RESOURCES");
    const booking = { ...body.booking, organizationId: context.tenant.organizationId, clinicId: context.tenant.clinicId };
    if (!validateBookingConfig(booking).valid) throw new Error("INVALID_BOOKING_CONFIGURATION");
    await writeFacilityConfiguration(context.tenant, { rooms, resources, booking: body.booking });
    const configuration = await readClinicConfiguration(context.tenant);
    return NextResponse.json({ ok: true, facility: { rooms: configuration.rooms, resources: configuration.resources, booking: configuration.booking } });
  } catch (error) { return fail(error); }
}
