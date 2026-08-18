import "server-only";

import { randomUUID } from "node:crypto";
import { fetchSheetRanges } from "@/lib/data/googleSheets";
import {
  assertCanPerform,
  canPerform,
  type AccessContext,
} from "@/lib/webos/access";
import {
  appendEntityWithAudit,
  appendRowsWithAudit,
  replaceEntityRowWithAudit,
  type SheetCellValue,
} from "@/lib/webos/sheetTransaction";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";
import { todayDhaka } from "@/lib/webos/reception";

const CHAT_SHEET = "28_Chat_Messages";
const EQUIPMENT_SHEET = "29_Equipment_Requests";
const RESOURCE_SHEET = "24_Chamber_Resources";
const SCHEMA_VERSION = "relife-uda-v1";
const ORGANIZATION_ID = "RELIFE";
const CLINIC_ID = "RELIFE-PHYSIO";
const BRANCH_ID = "AMTALI-01";
const CALL_PREFIX = "CALL:";
const BROADCAST_MARKER = "CALL:ALL:PHYSIO";

const LOCATIONS = new Set([
  "Shared",
  "Reception",
  "Room 1",
  "Room 2",
  "Traction Room",
]);

const EQUIPMENT_STATUSES = [
  "Requested",
  "Accepted",
  "Moving",
  "Delivered",
  "Returned",
  "Cancelled",
] as const;

type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

type MessagePriority = "Normal" | "Urgent";

type MessageType = "Message" | "System" | "Equipment";

export interface ChamberChatMessage {
  messageId: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  senderRoles: string[];
  messageType: MessageType;
  priority: MessagePriority;
  body: string;
  patientId: string;
  appointmentId: string;
  bedId: string;
  roomId: string;
  equipmentRequestId: string;
  status: string;
}

export interface ChamberEquipmentRequest {
  requestId: string;
  createdAt: string;
  updatedAt: string;
  requestedById: string;
  requestedByName: string;
  resourceId: string;
  resourceName: string;
  fromLocation: string;
  toLocation: string;
  patientId: string;
  patientName: string;
  appointmentId: string;
  bedId: string;
  neededDurationMin: number;
  priority: MessagePriority;
  status: EquipmentStatus;
  acceptedById: string;
  acceptedByName: string;
  acceptedAt: string;
  movingAt: string;
  deliveredAt: string;
  returnedAt: string;
  notes: string;
}

export interface ChamberMachineOption {
  resourceId: string;
  resourceName: string;
  roomId: string;
  defaultDurationMin: number;
}

export interface ChamberCommsSnapshot {
  currentStaffId: string;
  canUpdateEquipment: boolean;
  messages: ChamberChatMessage[];
  equipmentRequests: ChamberEquipmentRequest[];
  machines: ChamberMachineOption[];
  locations: string[];
  pendingUrgentCount: number;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase();
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalized);
  for (const name of names) {
    const index = values.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: string[], index: number): string {
  return index >= 0 ? normalize(row[index]) : "";
}

function numberAt(row: string[], index: number): number {
  const value = Number.parseFloat(at(row, index));
  return Number.isFinite(value) ? value : 0;
}

function nowDhaka(ref = new Date()): { display: string; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    display: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`,
    iso: ref.toISOString(),
  };
}

function parsePriority(value: unknown): MessagePriority {
  return normalized(value) === "urgent" ? "Urgent" : "Normal";
}

function parseMessageType(value: unknown): MessageType {
  const item = normalized(value);
  if (item === "system") return "System";
  if (item === "equipment") return "Equipment";
  return "Message";
}

function parseEquipmentStatus(value: unknown): EquipmentStatus {
  const item = normalized(value);
  return EQUIPMENT_STATUSES.find((status) => status.toLowerCase() === item) || "Requested";
}

function safeLocation(value: unknown, fallback: string): string {
  const location = normalize(value);
  return LOCATIONS.has(location) ? location : fallback;
}

function isTerminalEquipmentStatus(status: EquipmentStatus): boolean {
  return status === "Returned" || status === "Cancelled";
}

function canUpdateEquipment(context: AccessContext): boolean {
  return (
    canPerform(context, "chamber.run", "Physio") ||
    canPerform(context, "chamber.receive", "Physio")
  );
}

function canSendEmergencyBroadcast(context: AccessContext): boolean {
  return context.roles.some((role) => role === "Owner" || role === "Manager");
}

function callTargetMatches(marker: string, context: AccessContext): boolean {
  const value = normalize(marker);
  if (!value.startsWith(CALL_PREFIX)) return false;
  if (value === BROADCAST_MARKER) return true;
  if (value.startsWith("CALL:STAFF:")) {
    return value.slice("CALL:STAFF:".length) === context.staffId;
  }
  if (value.startsWith("CALL:ROLE:")) {
    const role = value.slice("CALL:ROLE:".length).trim().toLowerCase();
    return context.roles.some((item) => item.trim().toLowerCase() === role);
  }
  return false;
}

function parseSeenBy(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.map((item) => normalize(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function staffName(context: AccessContext): Promise<string> {
  const directory = await getWebStaffDirectory();
  return directory.find((staff) => staff.staffId === context.staffId)?.fullName || context.staffId;
}

function auditRow(
  context: AccessContext,
  action: string,
  entityType: string,
  entityId: string,
  patientId: string,
  before: string,
  after: string,
  reason: string,
  now = nowDhaka()
): SheetCellValue[] {
  return [
    `AUD-${randomUUID()}`,
    now.display,
    context.staffId,
    action,
    entityType,
    entityId,
    patientId,
    before,
    after,
    reason,
    ORGANIZATION_ID,
    CLINIC_ID,
    BRANCH_ID,
    `${CLINIC_ID}:${entityId}`,
    "",
    context.staffId,
    "web_pwa",
    "human_entry",
    false,
    true,
    SCHEMA_VERSION,
    now.iso,
    "Physio",
  ];
}

function parseMessages(rows: string[][]): ChamberChatMessage[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = {
    messageId: headerIndex(headers, "Message_ID"),
    createdAt: headerIndex(headers, "Created_At"),
    senderId: headerIndex(headers, "Sender_ID"),
    senderName: headerIndex(headers, "Sender_Name"),
    senderRoles: headerIndex(headers, "Sender_Roles"),
    messageType: headerIndex(headers, "Message_Type"),
    priority: headerIndex(headers, "Priority"),
    body: headerIndex(headers, "Body"),
    patientId: headerIndex(headers, "Patient_ID"),
    appointmentId: headerIndex(headers, "Appointment_ID"),
    bedId: headerIndex(headers, "Bed_ID"),
    roomId: headerIndex(headers, "Room_ID"),
    equipmentRequestId: headerIndex(headers, "Equipment_Request_ID"),
    status: headerIndex(headers, "Status"),
    department: headerIndex(headers, "Department"),
  };
  if (idx.messageId < 0 || idx.createdAt < 0 || idx.body < 0) throw new Error("SCHEMA_MISMATCH");
  const today = todayDhaka();
  return rows.slice(1).flatMap((row) => {
    const messageId = at(row, idx.messageId);
    if (!messageId) return [];
    const department = at(row, idx.department);
    if (department && department !== "Physio") return [];
    const createdAt = at(row, idx.createdAt);
    if (createdAt && !createdAt.startsWith(today)) return [];
    return [{
      messageId,
      createdAt,
      senderId: at(row, idx.senderId),
      senderName: at(row, idx.senderName),
      senderRoles: at(row, idx.senderRoles).split(",").map((item) => item.trim()).filter(Boolean),
      messageType: parseMessageType(at(row, idx.messageType)),
      priority: parsePriority(at(row, idx.priority)),
      body: at(row, idx.body),
      patientId: at(row, idx.patientId),
      appointmentId: at(row, idx.appointmentId),
      bedId: at(row, idx.bedId),
      roomId: at(row, idx.roomId),
      equipmentRequestId: at(row, idx.equipmentRequestId),
      status: at(row, idx.status) || "Active",
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 120);
}

function parseEquipmentRequests(rows: string[][]): ChamberEquipmentRequest[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = {
    requestId: headerIndex(headers, "Request_ID"),
    createdAt: headerIndex(headers, "Created_At"),
    updatedAt: headerIndex(headers, "Updated_At"),
    requestedById: headerIndex(headers, "Requested_By_ID"),
    requestedByName: headerIndex(headers, "Requested_By_Name"),
    resourceId: headerIndex(headers, "Resource_ID"),
    resourceName: headerIndex(headers, "Resource_Name"),
    fromLocation: headerIndex(headers, "From_Location"),
    toLocation: headerIndex(headers, "To_Location"),
    patientId: headerIndex(headers, "Patient_ID"),
    patientName: headerIndex(headers, "Patient_Name"),
    appointmentId: headerIndex(headers, "Appointment_ID"),
    bedId: headerIndex(headers, "Bed_ID"),
    neededDurationMin: headerIndex(headers, "Needed_Duration_Min"),
    priority: headerIndex(headers, "Priority"),
    status: headerIndex(headers, "Status"),
    acceptedById: headerIndex(headers, "Accepted_By_ID"),
    acceptedByName: headerIndex(headers, "Accepted_By_Name"),
    acceptedAt: headerIndex(headers, "Accepted_At"),
    movingAt: headerIndex(headers, "Moving_At"),
    deliveredAt: headerIndex(headers, "Delivered_At"),
    returnedAt: headerIndex(headers, "Returned_At"),
    notes: headerIndex(headers, "Notes"),
    department: headerIndex(headers, "Department"),
  };
  if (idx.requestId < 0 || idx.status < 0 || idx.resourceId < 0) throw new Error("SCHEMA_MISMATCH");
  const today = todayDhaka();
  return rows.slice(1).flatMap((row) => {
    const requestId = at(row, idx.requestId);
    if (!requestId) return [];
    const department = at(row, idx.department);
    if (department && department !== "Physio") return [];
    const status = parseEquipmentStatus(at(row, idx.status));
    const createdAt = at(row, idx.createdAt);
    if (createdAt && !createdAt.startsWith(today) && isTerminalEquipmentStatus(status)) return [];
    return [{
      requestId,
      createdAt,
      updatedAt: at(row, idx.updatedAt),
      requestedById: at(row, idx.requestedById),
      requestedByName: at(row, idx.requestedByName),
      resourceId: at(row, idx.resourceId),
      resourceName: at(row, idx.resourceName),
      fromLocation: at(row, idx.fromLocation),
      toLocation: at(row, idx.toLocation),
      patientId: at(row, idx.patientId),
      patientName: at(row, idx.patientName),
      appointmentId: at(row, idx.appointmentId),
      bedId: at(row, idx.bedId),
      neededDurationMin: numberAt(row, idx.neededDurationMin),
      priority: parsePriority(at(row, idx.priority)),
      status,
      acceptedById: at(row, idx.acceptedById),
      acceptedByName: at(row, idx.acceptedByName),
      acceptedAt: at(row, idx.acceptedAt),
      movingAt: at(row, idx.movingAt),
      deliveredAt: at(row, idx.deliveredAt),
      returnedAt: at(row, idx.returnedAt),
      notes: at(row, idx.notes),
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

function parseMachines(rows: string[][]): ChamberMachineOption[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const resourceId = headerIndex(headers, "Resource_ID");
  const resourceName = headerIndex(headers, "Resource_Name");
  const resourceType = headerIndex(headers, "Resource_Type");
  const roomId = headerIndex(headers, "Room_ID");
  const enabled = headerIndex(headers, "Enabled");
  const department = headerIndex(headers, "Department");
  const defaultDurationMin = headerIndex(headers, "Default_Duration_Min");
  if (resourceId < 0 || resourceName < 0 || resourceType < 0) throw new Error("SCHEMA_MISMATCH");
  return rows.slice(1).flatMap((row) => {
    if (normalized(at(row, resourceType)) !== "machine") return [];
    if (["false", "0", "no"].includes(normalized(at(row, enabled)))) return [];
    const dept = at(row, department);
    if (dept && dept !== "Physio") return [];
    return [{
      resourceId: at(row, resourceId),
      resourceName: at(row, resourceName),
      roomId: at(row, roomId) || "Shared",
      defaultDurationMin: numberAt(row, defaultDurationMin),
    }];
  }).filter((item) => item.resourceId && item.resourceName);
}

export async function getChamberCommsSnapshot(context: AccessContext): Promise<ChamberCommsSnapshot> {
  assertCanPerform(context, "chamber.read", "Physio");
  const snapshot = await fetchSheetRanges("physio", [CHAT_SHEET, EQUIPMENT_SHEET, RESOURCE_SHEET]);
  const messages = parseMessages(snapshot[CHAT_SHEET] || []);
  const equipmentRequests = parseEquipmentRequests(snapshot[EQUIPMENT_SHEET] || []);
  const machines = parseMachines(snapshot[RESOURCE_SHEET] || []);
  return {
    currentStaffId: context.staffId,
    canUpdateEquipment: canUpdateEquipment(context),
    messages,
    equipmentRequests,
    machines,
    locations: [...LOCATIONS],
    pendingUrgentCount:
      equipmentRequests.filter((item) => item.status === "Requested").length +
      messages.filter(
        (item) =>
          item.priority === "Urgent" &&
          item.messageType !== "Equipment" &&
          normalized(item.status || "Active") === "active"
      ).length,
  };
}

export async function sendChamberMessage(
  context: AccessContext,
  input: {
    body?: unknown;
    priority?: unknown;
    patientId?: unknown;
    appointmentId?: unknown;
    bedId?: unknown;
    roomId?: unknown;
  }
): Promise<{ messageId: string }> {
  assertCanPerform(context, "chamber.read", "Physio");
  const body = normalize(input.body);
  if (!body || body.length > 500) throw new Error("INVALID_MESSAGE");
  const priority = parsePriority(input.priority);
  const sender = await staffName(context);
  const now = nowDhaka();
  const messageId = `MSG-${randomUUID()}`;
  const patientId = normalize(input.patientId).slice(0, 80);
  const appointmentId = normalize(input.appointmentId).slice(0, 80);
  const bedId = normalize(input.bedId).slice(0, 80);
  const roomId = normalize(input.roomId).slice(0, 80);
  if (roomId.startsWith("CALL:ALL:")) {
    if (roomId !== BROADCAST_MARKER) throw new Error("INVALID_MESSAGE");
    if (!canSendEmergencyBroadcast(context)) throw new Error("ACCESS_DENIED");
  }
  const emergency = roomId === BROADCAST_MARKER;
  const row: SheetCellValue[] = [
    messageId,
    now.display,
    context.staffId,
    sender,
    context.roles.join(","),
    emergency ? "System" : "Message",
    priority,
    body,
    patientId,
    appointmentId,
    bedId,
    roomId,
    "",
    JSON.stringify([context.staffId]),
    "Active",
    "Physio",
    ORGANIZATION_ID,
    CLINIC_ID,
    BRANCH_ID,
    `${CLINIC_ID}:${messageId}`,
    "web_pwa",
    "human_entry",
    true,
    SCHEMA_VERSION,
  ];
  await appendEntityWithAudit(
    "physio",
    CHAT_SHEET,
    row,
    auditRow(
      context,
      emergency ? "chamber.broadcast.send" : "chamber.chat.send",
      emergency ? "ChamberBroadcast" : "ChatMessage",
      messageId,
      patientId,
      "",
      priority,
      emergency ? "Emergency Chamber broadcast sent" : "Chamber operational message sent",
      now
    )
  );
  return { messageId };
}

export async function acceptChamberCall(
  context: AccessContext,
  messageIdInput: unknown
): Promise<{
  messageId: string;
  status: "Accepted";
  acceptedById?: string;
  acceptedByName?: string;
}> {
  assertCanPerform(context, "chamber.read", "Physio");
  const messageId = normalize(messageIdInput);
  if (!messageId) throw new Error("INVALID_CALL_ID");

  const snapshot = await fetchSheetRanges("physio", [CHAT_SHEET]);
  const rows = snapshot[CHAT_SHEET] || [];
  if (rows.length < 2) throw new Error("CALL_NOT_FOUND");

  const headers = rows[0];
  const messageIdIdx = headerIndex(headers, "Message_ID");
  const statusIdx = headerIndex(headers, "Status");
  const roomIdIdx = headerIndex(headers, "Room_ID");
  const patientIdIdx = headerIndex(headers, "Patient_ID");
  const seenByIdx = headerIndex(headers, "Seen_By");
  if (messageIdIdx < 0 || statusIdx < 0 || roomIdIdx < 0) {
    throw new Error("SCHEMA_MISMATCH");
  }

  const offset = rows.slice(1).findIndex((row) => at(row, messageIdIdx) === messageId);
  if (offset < 0) throw new Error("CALL_NOT_FOUND");

  const row = [...rows[offset + 1]];
  while (row.length < headers.length) row.push("");
  const marker = at(row, roomIdIdx);
  if (!marker.startsWith(CALL_PREFIX)) throw new Error("CALL_NOT_FOUND");
  if (!callTargetMatches(marker, context)) throw new Error("CALL_TARGET_MISMATCH");

  const currentStatus = at(row, statusIdx) || "Active";
  if (normalized(currentStatus) === "accepted") {
    return { messageId, status: "Accepted" };
  }
  if (normalized(currentStatus) !== "active") throw new Error("CALL_NOT_ACTIVE");

  const actorName = await staffName(context);
  const now = nowDhaka();
  const seenBy = seenByIdx >= 0 ? parseSeenBy(at(row, seenByIdx)) : [];
  if (!seenBy.includes(context.staffId)) seenBy.push(context.staffId);
  row[statusIdx] = "Accepted";
  if (seenByIdx >= 0) row[seenByIdx] = JSON.stringify(seenBy);
  const emergency = marker === BROADCAST_MARKER;

  await replaceEntityRowWithAudit(
    "physio",
    CHAT_SHEET,
    offset + 2,
    row,
    auditRow(
      context,
      emergency ? "chamber.broadcast.accept" : "chamber.call.accept",
      emergency ? "ChamberBroadcast" : "ChamberCall",
      messageId,
      patientIdIdx >= 0 ? at(row, patientIdIdx) : "",
      JSON.stringify({ status: currentStatus, target: marker }),
      JSON.stringify({
        status: "Accepted",
        acceptedById: context.staffId,
        acceptedByName: actorName,
        acceptedAt: now.display,
      }),
      emergency
        ? `Emergency Chamber broadcast acknowledged by ${actorName}`
        : `Targeted Chamber call accepted by ${actorName}`,
      now
    )
  );

  return {
    messageId,
    status: "Accepted",
    acceptedById: context.staffId,
    acceptedByName: actorName,
  };
}

export async function createEquipmentRequest(
  context: AccessContext,
  input: {
    resourceId?: unknown;
    fromLocation?: unknown;
    toLocation?: unknown;
    patientId?: unknown;
    patientName?: unknown;
    appointmentId?: unknown;
    bedId?: unknown;
    neededDurationMin?: unknown;
    notes?: unknown;
  }
): Promise<{ requestId: string; messageId: string }> {
  assertCanPerform(context, "chamber.read", "Physio");
  const resourceId = normalize(input.resourceId);
  if (!resourceId) throw new Error("INVALID_RESOURCE");
  const sheet = await fetchSheetRanges("physio", [RESOURCE_SHEET]);
  const machines = parseMachines(sheet[RESOURCE_SHEET] || []);
  const machine = machines.find((item) => item.resourceId === resourceId);
  if (!machine) throw new Error("INVALID_RESOURCE");
  const fromLocation = safeLocation(input.fromLocation, machine.roomId || "Shared");
  const toLocation = safeLocation(input.toLocation, "Room 1");
  if (fromLocation === toLocation) throw new Error("INVALID_LOCATION");
  const requestedDuration = Number.parseInt(normalize(input.neededDurationMin), 10);
  const neededDurationMin = Number.isFinite(requestedDuration)
    ? Math.min(120, Math.max(5, requestedDuration))
    : Math.max(5, machine.defaultDurationMin || 15);
  const notes = normalize(input.notes).slice(0, 500);
  const sender = await staffName(context);
  const now = nowDhaka();
  const requestId = `EQR-${randomUUID()}`;
  const messageId = `MSG-${randomUUID()}`;
  const patientId = normalize(input.patientId).slice(0, 80);
  const patientName = normalize(input.patientName).slice(0, 120);
  const appointmentId = normalize(input.appointmentId).slice(0, 80);
  const bedId = normalize(input.bedId).slice(0, 80);
  const equipmentRow: SheetCellValue[] = [
    requestId,
    now.display,
    now.display,
    context.staffId,
    sender,
    machine.resourceId,
    machine.resourceName,
    fromLocation,
    toLocation,
    patientId,
    patientName,
    appointmentId,
    bedId,
    neededDurationMin,
    "Urgent",
    "Requested",
    "",
    "",
    "",
    "",
    "",
    "",
    notes,
    "Physio",
    ORGANIZATION_ID,
    CLINIC_ID,
    BRANCH_ID,
    `${CLINIC_ID}:${requestId}`,
    "web_pwa",
    SCHEMA_VERSION,
  ];
  const linkedBody = `${machine.resourceName} needed · ${fromLocation} → ${toLocation} · ${neededDurationMin} min${patientName ? ` · ${patientName}` : ""}`;
  const chatRow: SheetCellValue[] = [
    messageId,
    now.display,
    context.staffId,
    sender,
    context.roles.join(","),
    "Equipment",
    "Urgent",
    linkedBody,
    patientId,
    appointmentId,
    bedId,
    toLocation,
    requestId,
    JSON.stringify([context.staffId]),
    "Active",
    "Physio",
    ORGANIZATION_ID,
    CLINIC_ID,
    BRANCH_ID,
    `${CLINIC_ID}:${messageId}`,
    "web_pwa",
    "human_entry",
    true,
    SCHEMA_VERSION,
  ];
  await appendRowsWithAudit(
    "physio",
    [
      { sheet: EQUIPMENT_SHEET, row: equipmentRow },
      { sheet: CHAT_SHEET, row: chatRow },
    ],
    auditRow(
      context,
      "chamber.equipment.request",
      "EquipmentRequest",
      requestId,
      patientId,
      "",
      JSON.stringify({ resourceId: machine.resourceId, fromLocation, toLocation, neededDurationMin }),
      "Urgent Chamber equipment request created",
      now
    )
  );
  return { requestId, messageId };
}

const NEXT_STATUS: Record<EquipmentStatus, EquipmentStatus[]> = {
  Requested: ["Accepted", "Cancelled"],
  Accepted: ["Moving", "Cancelled"],
  Moving: ["Delivered", "Cancelled"],
  Delivered: ["Returned"],
  Returned: [],
  Cancelled: [],
};

export async function updateEquipmentRequestStatus(
  context: AccessContext,
  requestIdInput: unknown,
  statusInput: unknown
): Promise<{ requestId: string; status: EquipmentStatus }> {
  assertCanPerform(context, "chamber.read", "Physio");
  if (!canUpdateEquipment(context)) throw new Error("ACCESS_DENIED");
  const requestId = normalize(requestIdInput);
  const nextStatus = parseEquipmentStatus(statusInput);
  if (!requestId) throw new Error("EQUIPMENT_REQUEST_NOT_FOUND");
  const snapshot = await fetchSheetRanges("physio", [EQUIPMENT_SHEET]);
  const rows = snapshot[EQUIPMENT_SHEET] || [];
  if (rows.length < 2) throw new Error("EQUIPMENT_REQUEST_NOT_FOUND");
  const headers = rows[0];
  const requestIdIdx = headerIndex(headers, "Request_ID");
  const statusIdx = headerIndex(headers, "Status");
  const updatedAtIdx = headerIndex(headers, "Updated_At");
  const patientIdIdx = headerIndex(headers, "Patient_ID");
  const acceptedByIdIdx = headerIndex(headers, "Accepted_By_ID");
  const acceptedByNameIdx = headerIndex(headers, "Accepted_By_Name");
  const acceptedAtIdx = headerIndex(headers, "Accepted_At");
  const movingAtIdx = headerIndex(headers, "Moving_At");
  const deliveredAtIdx = headerIndex(headers, "Delivered_At");
  const returnedAtIdx = headerIndex(headers, "Returned_At");
  if (requestIdIdx < 0 || statusIdx < 0 || updatedAtIdx < 0) throw new Error("SCHEMA_MISMATCH");
  const offset = rows.slice(1).findIndex((row) => at(row, requestIdIdx) === requestId);
  if (offset < 0) throw new Error("EQUIPMENT_REQUEST_NOT_FOUND");
  const row = [...rows[offset + 1]];
  while (row.length < headers.length) row.push("");
  const currentStatus = parseEquipmentStatus(at(row, statusIdx));
  if (currentStatus === nextStatus) return { requestId, status: currentStatus };
  if (!NEXT_STATUS[currentStatus].includes(nextStatus)) throw new Error("INVALID_EQUIPMENT_TRANSITION");
  const now = nowDhaka();
  const actorName = await staffName(context);
  row[statusIdx] = nextStatus;
  row[updatedAtIdx] = now.display;
  if (nextStatus === "Accepted") {
    if (acceptedByIdIdx >= 0) row[acceptedByIdIdx] = context.staffId;
    if (acceptedByNameIdx >= 0) row[acceptedByNameIdx] = actorName;
    if (acceptedAtIdx >= 0) row[acceptedAtIdx] = now.display;
  }
  if (nextStatus === "Moving" && movingAtIdx >= 0) row[movingAtIdx] = now.display;
  if (nextStatus === "Delivered" && deliveredAtIdx >= 0) row[deliveredAtIdx] = now.display;
  if (nextStatus === "Returned" && returnedAtIdx >= 0) row[returnedAtIdx] = now.display;
  await replaceEntityRowWithAudit(
    "physio",
    EQUIPMENT_SHEET,
    offset + 2,
    row,
    auditRow(
      context,
      "chamber.equipment.status",
      "EquipmentRequest",
      requestId,
      patientIdIdx >= 0 ? at(row, patientIdIdx) : "",
      currentStatus,
      nextStatus,
      `Equipment request moved ${currentStatus} → ${nextStatus}`,
      now
    )
  );
  return { requestId, status: nextStatus };
}
