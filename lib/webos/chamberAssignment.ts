import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  updateSheetValues,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { todayDhaka } from "@/lib/webos/reception";
import { getWebStaffDirectory } from "@/lib/webos/staffDirectory";

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

function columnLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
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

async function appendAudit(
  context: AccessContext,
  appointmentId: string,
  patientId: string,
  before: string,
  after: string
) {
  const now = nowDhaka();
  try {
    await appendSheetValues("physio", "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.display,
      context.staffId,
      "chamber.therapist.assign",
      "Appointment",
      appointmentId,
      patientId,
      before,
      after,
      "Today's therapist changed from Live Chamber",
      "RELIFE",
      "RELIFE-PHYSIO",
      "AMTALI-01",
      `RELIFE-PHYSIO:${appointmentId}`,
      "",
      context.staffId,
      "web_pwa",
      "human_entry",
      false,
      true,
      "relife-uda-v1",
      now.iso,
      "Physio",
    ]]);
  } catch (error) {
    console.error("Chamber therapist assignment audit failed", error);
  }
}

export async function assignChamberTherapist(
  context: AccessContext,
  appointmentIdInput: string,
  staffIdInput: string
): Promise<{ appointmentId: string; therapist: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const appointmentId = normalize(appointmentIdInput);
  const staffId = normalize(staffIdInput);
  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!staffId) throw new Error("STAFF_NOT_FOUND");

  const directory = await getWebStaffDirectory();
  const therapist = directory.find(
    (staff) =>
      staff.staffId === staffId &&
      staff.status === "Active" &&
      staff.roles.includes("Therapist") &&
      (staff.departmentAccess.includes("Physio") || staff.departmentAccess.includes("All"))
  );
  if (!therapist) throw new Error("STAFF_NOT_FOUND");

  const snapshot = await fetchSheetRanges("physio", ["04_Appointments", "23_Chamber_Sessions"]);
  const appointments = snapshot["04_Appointments"] || [];
  if (appointments.length < 2) throw new Error("APPOINTMENT_NOT_FOUND");
  const appointmentHeaders = appointments[0];
  const appointmentIdIdx = headerIndex(appointmentHeaders, "Appointment_ID");
  const patientIdIdx = headerIndex(appointmentHeaders, "Patient_ID");
  const dateIdx = headerIndex(appointmentHeaders, "Date");
  const statusIdx = headerIndex(appointmentHeaders, "Status");
  const therapistIdx = headerIndex(appointmentHeaders, "Therapist");
  if (appointmentIdIdx < 0 || therapistIdx < 0) throw new Error("SCHEMA_MISMATCH");

  const appointmentOffset = appointments.slice(1).findIndex(
    (row) => at(row, appointmentIdIdx) === appointmentId
  );
  if (appointmentOffset < 0) throw new Error("APPOINTMENT_NOT_FOUND");
  const appointmentRow = appointments[appointmentOffset + 1];
  const activeStatuses = new Set(["scheduled", "arrived", "waiting", "in treatment"]);
  if (dateIdx >= 0 && at(appointmentRow, dateIdx) !== todayDhaka()) throw new Error("APPOINTMENT_NOT_ACTIVE");
  if (statusIdx >= 0 && !activeStatuses.has(normalized(at(appointmentRow, statusIdx)))) {
    throw new Error("APPOINTMENT_NOT_ACTIVE");
  }

  const oldTherapist = at(appointmentRow, therapistIdx);
  if (normalized(oldTherapist) === normalized(therapist.fullName)) {
    return { appointmentId, therapist: therapist.fullName };
  }

  const appointmentSheetRow = appointmentOffset + 2;
  await updateSheetValues(
    "physio",
    `'04_Appointments'!${columnLetter(therapistIdx)}${appointmentSheetRow}`,
    [[therapist.fullName]]
  );

  const sessions = snapshot["23_Chamber_Sessions"] || [];
  if (sessions.length >= 2) {
    const sessionHeaders = sessions[0];
    const sessionAppointmentIdx = headerIndex(sessionHeaders, "Appointment_ID");
    const sessionStatusIdx = headerIndex(sessionHeaders, "Status");
    const sessionTherapistIdx = headerIndex(sessionHeaders, "Therapist");
    if (sessionAppointmentIdx >= 0 && sessionTherapistIdx >= 0) {
      const sessionOffset = sessions.slice(1).findIndex((row) => {
        if (at(row, sessionAppointmentIdx) !== appointmentId) return false;
        const status = sessionStatusIdx >= 0 ? normalized(at(row, sessionStatusIdx)) : "waiting";
        return status === "waiting" || status === "in treatment";
      });
      if (sessionOffset >= 0) {
        await updateSheetValues(
          "physio",
          `'23_Chamber_Sessions'!${columnLetter(sessionTherapistIdx)}${sessionOffset + 2}`,
          [[therapist.fullName]]
        );
      }
    }
  }

  await appendAudit(
    context,
    appointmentId,
    patientIdIdx >= 0 ? at(appointmentRow, patientIdIdx) : "",
    oldTherapist,
    therapist.fullName
  );
  return { appointmentId, therapist: therapist.fullName };
}
