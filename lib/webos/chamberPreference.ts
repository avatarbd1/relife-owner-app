import "server-only";

import { randomUUID } from "node:crypto";
import {
  appendSheetValues,
  fetchSheetRanges,
  updateSheetValues,
} from "@/lib/data/googleSheets";
import { assertCanPerform, type AccessContext } from "@/lib/webos/access";
import { getChamberSnapshot } from "@/lib/webos/chamber";

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedHeader(value: unknown): string {
  return normalize(value).toLowerCase();
}

function headerIndex(headers: string[], ...names: string[]): number {
  const values = headers.map(normalizedHeader);
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

function flowTag(
  remarks: string,
  gender: string,
  room: string,
  bed: string,
  station: string
): string {
  const clean = normalize(remarks).replace(/\[PTFLOW\s+[^\]]+\]/gi, "").trim();
  const tag = `[PTFLOW gender=${gender};room=${room};bed=${bed};station=${station}]`;
  return `${clean} ${tag}`.trim();
}

async function auditPreference(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  appointmentId: string,
  patientId: string,
  stationId: string
) {
  const now = nowDhaka();
  try {
    await appendSheetValues("physio", "'20_Data_Audit'!A:W", [[
      `AUD-${randomUUID()}`,
      now.display,
      context.staffId,
      "chamber.bed.preference",
      "Appointment",
      appointmentId,
      patientId,
      "",
      stationId,
      "Pre-start preferred bed selected from Live Chamber",
      organizationId,
      clinicId,
      "AMTALI-01",
      `${clinicId}:${appointmentId}`,
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
    console.error("Chamber bed preference audit failed", error);
  }
}

export async function setChamberBedPreference(
  context: AccessContext,
  organizationId: string,
  clinicId: string,
  appointmentIdInput: string,
  stationIdInput: string
): Promise<{ appointmentId: string; stationId: string }> {
  assertCanPerform(context, "chamber.run", "Physio");
  const appointmentId = normalize(appointmentIdInput);
  const stationId = normalize(stationIdInput);
  if (!appointmentId) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!stationId) throw new Error("STATION_NOT_FOUND");

  const chamber = await getChamberSnapshot(context);
  const queueItem = chamber.queue.find((item) => item.appointmentId === appointmentId);
  if (!queueItem) throw new Error("APPOINTMENT_NOT_FOUND");
  if (!queueItem.sessionId || queueItem.sessionStatus !== "Waiting") {
    throw new Error("CHAMBER_SESSION_NOT_WAITING");
  }

  const stationView = chamber.stations.find((item) => item.resource.resourceId === stationId);
  if (!stationView) throw new Error("STATION_NOT_FOUND");
  if (stationView.session && stationView.session.sessionId !== queueItem.sessionId) {
    throw new Error("CHAMBER_CAPACITY:STATION_BUSY");
  }

  const isTraction = stationId === "TRACTION-BED";
  if (!isTraction && !queueItem.gender) throw new Error("PATIENT_GENDER_REQUIRED");
  if (
    !isTraction &&
    stationView.roomGender &&
    stationView.roomGender !== queueItem.gender
  ) {
    throw new Error(`CHAMBER_CAPACITY:ROOM_GENDER:${stationView.roomGender}`);
  }

  const snapshot = await fetchSheetRanges("physio", ["04_Appointments"]);
  const rows = snapshot["04_Appointments"] || [];
  if (rows.length < 2) throw new Error("APPOINTMENT_NOT_FOUND");
  const headers = rows[0];
  const idIdx = headerIndex(headers, "Appointment_ID");
  const remarksIdx = headerIndex(headers, "Remarks");
  if (idIdx < 0 || remarksIdx < 0) throw new Error("SCHEMA_MISMATCH");
  const rowOffset = rows.slice(1).findIndex((row) => at(row, idIdx) === appointmentId);
  if (rowOffset < 0) throw new Error("APPOINTMENT_NOT_FOUND");

  const row = rows[rowOffset + 1];
  const currentRemarks = at(row, remarksIdx);
  const bed = isTraction
    ? "Traction Bed"
    : /^BED-(\d+)$/i.exec(stationId)?.[1]
      ? `Bed ${/^BED-(\d+)$/i.exec(stationId)?.[1]}`
      : stationView.resource.resourceName;
  const station = isTraction ? "Traction" : "Treatment";
  const nextRemarks = flowTag(
    currentRemarks,
    queueItem.gender,
    stationView.resource.roomId,
    bed,
    station
  );
  const sheetRow = rowOffset + 2;
  await updateSheetValues(
    "physio",
    `'04_Appointments'!${columnLetter(remarksIdx)}${sheetRow}`,
    [[nextRemarks]]
  );
  await auditPreference(context, organizationId, clinicId, appointmentId, queueItem.patientId, stationId);
  return { appointmentId, stationId };
}
