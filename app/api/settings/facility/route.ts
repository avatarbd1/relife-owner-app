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
    return NextResponse.json({ ok: true, facility: { rooms: rooms || [], resources: resources || [], booking } });
  } catch (error) { return fail(error); }
}

export async function PUT(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false, error: "Origin rejected" }, { status: 403 });
  try {
    const context = await requireCurrentTenantAccessContext(); authorize(context);
    const body = await request.json() as { rooms?: Omit<ClinicRoomConfiguration, "organizationId" | "clinicId">[]; resources?: Omit<ClinicResource, "organizationId" | "clinicId">[]; bulk?: BulkRoomResourceInput; booking?: Omit<ClinicBookingConfig, "organizationId" | "clinicId"> };
    const generated = body.bulk ? createBulkFacilityPlan(context.tenant, body.bulk) : null;
    const requestedRooms = generated?.rooms || body.rooms;
    const requestedResources = generated?.resources || body.resources;
    const requestedBooking = body.booking;
    if (!Array.isArray(requestedRooms) || !Array.isArray(requestedResources) || !requestedBooking) throw new Error("FACILITY_CONFIGURATION_REQUIRED");

    const requestedRoomCodes = new Set(requestedRooms.map((row) => row.roomCode.trim()));
    if (requestedRoomCodes.has("") || requestedRoomCodes.size !== requestedRooms.length || requestedRooms.some((row) => !row.displayName.trim())) throw new Error("INVALID_ROOMS");
    const requestedResourceCodes = new Set(requestedResources.map((row) => row.resourceCode.trim()));
    // The platform offers exactly one clinic template (Physiotherapy), so
    // the Dental-only chair resource type is intentionally not accepted.
    const resourceTypes = new Set(["BED", "TREATMENT_TABLE", "CABIN", "ROOM", "MACHINE", "OTHER"]);
    if (requestedResourceCodes.has("") || requestedResourceCodes.size !== requestedResources.length || requestedResources.some((row) => !row.displayName.trim() || !resourceTypes.has(row.resourceType) || !Number.isInteger(row.capacity) || row.capacity <= 0 || (row.roomCode !== null && !requestedRoomCodes.has(row.roomCode)))) throw new Error("INVALID_RESOURCES");

    const booking = { ...requestedBooking, organizationId: context.tenant.organizationId, clinicId: context.tenant.clinicId };
    if (!validateBookingConfig(booking).valid) throw new Error("INVALID_BOOKING_CONFIGURATION");

    // Facility PUT is replacement semantics without destructive deletes. Rows omitted by
    // the new configuration are explicitly deactivated so shrinking 6 rooms to 2 (or
    // switching to a room-less clinic) cannot leave old resources active at runtime.
    const existing = await readClinicConfiguration(context.tenant);
    const staleRooms = (existing.rooms || [])
      .filter((row) => !requestedRoomCodes.has(row.roomCode))
      .map((row) => ({
        roomCode: row.roomCode,
        displayName: row.displayName,
        isActive: false,
        sortOrder: row.sortOrder,
      }));
    const staleResources = (existing.resources || [])
      .filter((row) => !requestedResourceCodes.has(row.resourceCode))
      .map((row) => ({
        resourceCode: row.resourceCode,
        displayName: row.displayName,
        resourceType: row.resourceType,
        roomCode: row.roomCode,
        capacity: row.capacity,
        genderRestriction: row.genderRestriction,
        isBookable: false,
        isRuntimeOnly: row.isRuntimeOnly,
        isActive: false,
      }));

    await writeFacilityConfiguration(context.tenant, {
      rooms: [...requestedRooms, ...staleRooms],
      resources: [...requestedResources, ...staleResources],
      booking: requestedBooking,
    });
    const configuration = await readClinicConfiguration(context.tenant);
    return NextResponse.json({ ok: true, facility: { rooms: configuration.rooms || [], resources: configuration.resources || [], booking: configuration.booking } });
  } catch (error) { return fail(error); }
}
