import "server-only";

import type { ChamberChatContext, ChamberChatRecipient, ChamberChatWorkspacePayload } from "@/lib/types/chamberChat";
import type { AccessContext } from "@/lib/webos/access";
import { getChamberSnapshot } from "@/lib/webos/chamber";
import { getChamberCommsSnapshot } from "@/lib/webos/chamberComms";
import { getAppointmentsForContext, todayDhaka } from "@/lib/webos/reception";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

const ACTIVE_APPOINTMENT_STATUSES = new Set([
  "scheduled",
  "arrived",
  "waiting",
  "in treatment",
]);

const CHAT_ROLES = new Set(["Owner", "Manager", "Receptionist", "Therapist"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function isActiveStatus(value: string): boolean {
  return ACTIVE_APPOINTMENT_STATUSES.has(normalized(value));
}

function mergeContext(
  target: Map<string, ChamberChatContext>,
  next: ChamberChatContext
) {
  const current = target.get(next.appointmentId);
  if (!current) {
    target.set(next.appointmentId, next);
    return;
  }
  target.set(next.appointmentId, {
    ...current,
    ...next,
    sessionId: next.sessionId || current.sessionId,
    patientId: next.patientId || current.patientId,
    patientName: next.patientName || current.patientName,
    therapist: next.therapist || current.therapist,
    roomId: next.roomId || current.roomId,
    bedId: next.bedId || current.bedId,
    time: next.time || current.time,
    status: next.status || current.status,
    active: current.active || next.active,
  });
}

function recipientRank(recipient: ChamberChatRecipient): number {
  if (recipient.roles.includes("Owner")) return 0;
  if (recipient.roles.includes("Manager")) return 1;
  if (recipient.roles.includes("Receptionist")) return 2;
  if (recipient.roles.includes("Therapist")) return 3;
  return 9;
}

export async function getChamberChatWorkspace(
  context: AccessContext
): Promise<ChamberChatWorkspacePayload> {
  const today = todayDhaka();
  const [chamber, comms, appointments, directory] = await Promise.all([
    getChamberSnapshot(context),
    getChamberCommsSnapshot(context),
    getAppointmentsForContext(context, "physio", today),
    getWebStaffDirectory(),
  ]);

  const appointmentById = new Map(
    appointments.map((appointment) => [appointment.appointmentId, appointment])
  );
  const visibleAppointmentIds = new Set(appointmentById.keys());
  const messages = comms.messages.filter(
    (message) =>
      Boolean(message.appointmentId) &&
      visibleAppointmentIds.has(message.appointmentId)
  );
  const contexts = new Map<string, ChamberChatContext>();

  for (const station of chamber.stations) {
    const session = station.session;
    if (!session || !visibleAppointmentIds.has(session.appointmentId)) continue;
    const appointment = appointmentById.get(session.appointmentId);
    mergeContext(contexts, {
      appointmentId: session.appointmentId,
      sessionId: session.sessionId,
      patientId: session.patientId,
      patientName: session.patientName,
      therapist: appointment?.therapist || session.therapist,
      roomId: session.roomId || station.resource.roomId,
      bedId: station.resource.resourceName || session.stationId,
      time: appointment?.time || "",
      status: appointment?.status || session.status,
      active: true,
    });
  }

  for (const item of chamber.queue) {
    if (!visibleAppointmentIds.has(item.appointmentId)) continue;
    const appointment = appointmentById.get(item.appointmentId);
    mergeContext(contexts, {
      appointmentId: item.appointmentId,
      sessionId: item.sessionId,
      patientId: item.patientId,
      patientName: item.patientName,
      therapist: item.therapist || appointment?.therapist || "",
      roomId: "",
      bedId: item.recommendedStationId,
      time: item.time || appointment?.time || "",
      status: appointment?.status || item.sessionStatus || item.appointmentStatus,
      active: true,
    });
  }

  const messagesOldestFirst = [...messages].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  for (const message of messagesOldestFirst) {
    const appointment = appointmentById.get(message.appointmentId);
    if (!appointment) continue;
    mergeContext(contexts, {
      appointmentId: appointment.appointmentId,
      sessionId: "",
      patientId: appointment.patientId || message.patientId,
      patientName: appointment.patientName,
      therapist: appointment.therapist,
      roomId: message.roomId,
      bedId: message.bedId,
      time: appointment.time,
      status: appointment.status,
      active: isActiveStatus(appointment.status),
    });
  }

  for (const appointment of appointments) {
    if (!isActiveStatus(appointment.status)) continue;
    if (contexts.has(appointment.appointmentId)) continue;
    mergeContext(contexts, {
      appointmentId: appointment.appointmentId,
      sessionId: "",
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      therapist: appointment.therapist,
      roomId: "",
      bedId: "",
      time: appointment.time,
      status: appointment.status,
      active: true,
    });
  }

  const recipients: ChamberChatRecipient[] = directory
    .filter(
      (staff) =>
        staff.status === "Active" &&
        (staff.departmentAccess.includes("Physio") ||
          staff.departmentAccess.includes("All")) &&
        staff.roles.some((role) => CHAT_ROLES.has(role))
    )
    .map((staff) => ({
      staffId: staff.staffId,
      fullName: staff.fullName || staff.staffId,
      roles: staff.roles,
    }))
    .sort(
      (a, b) =>
        recipientRank(a) - recipientRank(b) ||
        a.fullName.localeCompare(b.fullName)
    );

  const orderedContexts = [...contexts.values()].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const timeCompare = (a.time || "99:99").localeCompare(b.time || "99:99");
    if (timeCompare !== 0) return timeCompare;
    return a.patientName.localeCompare(b.patientName);
  });

  const pendingUrgentCount = messages.filter(
    (message) =>
      message.priority === "Urgent" &&
      normalized(message.status || "Active") === "active"
  ).length;

  return {
    currentStaffId: context.staffId,
    contexts: orderedContexts,
    recipients,
    messages,
    pendingUrgentCount,
  };
}
