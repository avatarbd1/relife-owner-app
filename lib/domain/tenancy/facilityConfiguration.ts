import type { ClinicResource, ResourceType } from "./clinicConfiguration.ts";
import type { ClinicRoomConfiguration } from "./configurationCore.ts";
import { requireTenantScope, type TenantScope } from "./policy.ts";

export interface BulkRoomResourceInput {
  roomCount: number;
  resourcesPerRoom: number;
  roomCodePrefix?: string;
  resourceCodePrefix?: string;
  resourceType: ResourceType;
  resourceCapacity?: number;
  isBookable?: boolean;
  isRuntimeOnly?: boolean;
}

export function createBulkFacilityPlan(scope: TenantScope, input: BulkRoomResourceInput): { rooms: ClinicRoomConfiguration[]; resources: ClinicResource[] } {
  const tenant = requireTenantScope(scope);
  if (!Number.isInteger(input.roomCount) || input.roomCount < 1 || input.roomCount > 100) throw new Error("INVALID_ROOM_COUNT");
  if (!Number.isInteger(input.resourcesPerRoom) || input.resourcesPerRoom < 1 || input.resourcesPerRoom > 100) throw new Error("INVALID_RESOURCES_PER_ROOM");
  const capacity = input.resourceCapacity ?? 1;
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("INVALID_RESOURCE_CAPACITY");
  const roomPrefix = (input.roomCodePrefix || "ROOM").trim().toUpperCase();
  const resourcePrefix = (input.resourceCodePrefix || input.resourceType).trim().toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(roomPrefix) || !/^[A-Z0-9_-]+$/.test(resourcePrefix)) throw new Error("INVALID_RESOURCE_PREFIX");
  const rooms: ClinicRoomConfiguration[] = [];
  const resources: ClinicResource[] = [];
  let resourceNumber = 1;
  for (let roomNumber = 1; roomNumber <= input.roomCount; roomNumber += 1) {
    const roomCode = `${roomPrefix}-${roomNumber}`;
    rooms.push({ ...tenant, roomCode, displayName: `Room ${roomNumber}`, isActive: true, sortOrder: roomNumber });
    for (let index = 0; index < input.resourcesPerRoom; index += 1) {
      const resourceCode = `${resourcePrefix}-${resourceNumber}`;
      resources.push({ ...tenant, resourceCode, displayName: `${input.resourceType.replaceAll("_", " ")} ${resourceNumber}`, resourceType: input.resourceType, roomCode, capacity, genderRestriction: null, isBookable: input.isBookable ?? true, isRuntimeOnly: input.isRuntimeOnly ?? false, isActive: true });
      resourceNumber += 1;
    }
  }
  return { rooms, resources };
}
