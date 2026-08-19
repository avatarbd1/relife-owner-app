import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  updateSheetValues,
  type Workbook,
} from "@/lib/data/googleSheets";
import { recordAppointmentCompletionGamification } from "@/lib/domain/gamification/events";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

export const APPOINTMENT_STATUSES = [
  "Scheduled",
  "Arrived",
  "Waiting",
  "In Treatment",
  "Completed",
  "No-show",
  "Cancelled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

type ClinicDepartment = "Physio" | "Dental";

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
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function workbookForDepartment(department: ClinicDepartment): Workbook {
  return department === "Dental" ? "dental" : "physio";
}

function clinicId(department: ClinicDepartment): string {
  return department === "Dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}

function dhakaNow(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    timestamp: `${date} ${values.hour}:${values.minute}`,
    provenance: ref.toISOString(),
  };
}

async function projectCompletedAppointment(
  context: AccessContext,
  input: {
    appointmentId: string;
    department: ClinicDepartment;
    patientId: string;
    therapistReference: string;
    appointmentDate: string;
    appointmentTime: string;
    completedAt: string;
    previousStatus: string;
  }
): Promise<void> {
  const outcome = await recordAppointmentCompletionGamification({
    ...input,
    actorContext: context,
  });
  if (!outcome.recorded) {
    console.warn("Appointment completed without Gamification v2 projection", {
      appointmentId: input.appointmentId,
      department: input.department,
      reason: outcome.reason,
      staffId: outcome.staffId,
    });
  }
}

export async function updateAppointmentStatus(
  context: AccessContext,
  input: {
    appointmentId: string;
    department: ClinicDepartment | string;
    status: AppointmentStatus | string;
  }
): Promise<{ appointmentId: string; status: AppointmentStatus }> {
  const appointmentId = normalize(input.appointmentId);
  const department = normalize(input.department) as ClinicDepartment;
  const status = normalize(input.status) as AppointmentStatus;
  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!(["Physio", "Dental"] as string[]).includes(department)) {
    throw new Error("INVALID_DEPARTMENT");
  }
  if (!APPOINTMENT_STATUSES.includes(status)) throw new Error("INVALID_APPOINTMENT_STATUS");
  assertCanPerform(context, "appointment.update", department);

  const workbook = workbookForDepartment(department);
  const snapshot = await fetchSheetRanges(workbook, ["04_Appointments"]);
  const rows = snapshot["04_Appointments"] || [];
  if (rows.length < 1) throw new Error("SCHEMA_MISMATCH");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const statusIdx = headerIndex(headers, "Status");
  const departmentIdx = headerIndex(headers, "Department");
  const patientIdx = headerIndex(headers, "Patient_ID");
  const therapistIdx = headerIndex(headers, "Therapist");
  const dateIdx = headerIndex(headers, "Date");
  const timeIdx = headerIndex(headers, "Time");
  const updatedIdx = headerIndex(headers, "Last_Updated", "Updated_At");
  if (idIdx < 0 || statusIdx < 0) throw new Error("SCHEMA_MISMATCH");

  const rowOffset = rows.slice(1).findIndex((row) => at(row, idIdx) === appointmentId);
  if (rowOffset < 0) throw new Error("APPOINTMENT_NOT_FOUND");
  const row = rows[rowOffset + 1];
  const rowDepartment = at(row, departmentIdx);
  if (rowDepartment && normalized(rowDepartment) !== normalized(department)) {
    throw new Error("DEPARTMENT_MISMATCH");
  }
  const previous = at(row, statusIdx) || "Scheduled";
  const now = dhakaNow();

  // A repeated Completed mutation is also a safe repair opportunity. The
  // deterministic event key in the Gamification API prevents duplicate XP.
  if (normalized(previous) === normalized(status)) {
    if (status === "Completed") {
      await projectCompletedAppointment(context, {
        appointmentId,
        department,
        patientId: at(row, patientIdx),
        therapistReference: at(row, therapistIdx),
        appointmentDate: at(row, dateIdx),
        appointmentTime: at(row, timeIdx),
        completedAt: now.provenance,
        previousStatus: previous,
      });
    }
    return { appointmentId, status };
  }

  const sheetRow = rowOffset + 2;
  const updates: Array<Promise<void>> = [
    updateSheetValues(
      workbook,
      `'04_Appointments'!${columnLetter(statusIdx)}${sheetRow}`,
      [[status]]
    ),
  ];
  if (updatedIdx >= 0) {
    updates.push(
      updateSheetValues(
        workbook,
        `'04_Appointments'!${columnLetter(updatedIdx)}${sheetRow}`,
        [[now.timestamp]]
      )
    );
  }
  await Promise.all(updates);

  try {
    const clinic = clinicId(department);
    await appendSheetValues(workbook, "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.timestamp,
      context.staffId,
      "appointment.status.update",
      "Appointment",
      appointmentId,
      at(row, patientIdx),
      previous,
      status,
      "Telegram → Web today appointment status parity",
      "RELIFE",
      clinic,
      "AMTALI-01",
      `${clinic}:${appointmentId}`,
      "",
      context.staffId,
      "web_pwa",
      "human_entry",
      false,
      true,
      "relife-uda-v1",
      now.provenance,
      department,
    ]]);
  } catch (error) {
    console.error("Appointment status audit append failed", error);
  }

  if (status === "Completed") {
    await projectCompletedAppointment(context, {
      appointmentId,
      department,
      patientId: at(row, patientIdx),
      therapistReference: at(row, therapistIdx),
      appointmentDate: at(row, dateIdx),
      appointmentTime: at(row, timeIdx),
      completedAt: now.provenance,
      previousStatus: previous,
    });
  }

  return { appointmentId, status };
}
