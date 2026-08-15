import "server-only";

import { fetchSheetRanges, updateSheetValues } from "@/lib/data/googleSheets";
import type { ChamberSnapshot } from "@/lib/webos/chamber";
import type { AccessContext } from "@/lib/webos/access";
import { getVisiblePatients } from "@/lib/webos/reception";

const SESSION_SHEET = "23_Chamber_Sessions";
const ACTIVE_STATUSES = new Set(["waiting", "in treatment"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalized(value: unknown): string {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
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

function chamberGender(value: unknown): "Male" | "Female" | "" {
  const text = normalized(value);
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function nowDhaka(): { display: string; iso: string } {
  const ref = new Date();
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

export async function enrichChamberSnapshotWithPatientProfiles(
  context: AccessContext,
  snapshot: ChamberSnapshot
): Promise<ChamberSnapshot> {
  const patients = await getVisiblePatients(context, "physio");
  const byId = new Map(patients.map((patient) => [patient.patientId.toLowerCase(), patient]));

  return {
    ...snapshot,
    queue: snapshot.queue.map((item) => {
      const patient = byId.get(item.patientId.toLowerCase());
      if (!patient) return item;
      return {
        ...item,
        patientName: patient.fullName || item.patientName,
        gender: chamberGender(patient.gender),
      };
    }),
    stations: snapshot.stations.map((station) => {
      if (!station.session) return station;
      const patient = byId.get(station.session.patientId.toLowerCase());
      if (!patient) return station;
      return {
        ...station,
        session: {
          ...station.session,
          patientName: patient.fullName || station.session.patientName,
          gender: chamberGender(patient.gender),
        },
      };
    }),
  };
}

export async function syncActiveChamberPatientProfile(
  staffId: string,
  patientId: string,
  input: { fullName?: unknown; gender?: unknown }
): Promise<boolean> {
  const hasName = input.fullName !== undefined;
  const hasGender = input.gender !== undefined;
  if (!hasName && !hasGender) return true;

  const snapshot = await fetchSheetRanges("physio", [SESSION_SHEET]);
  const rows = snapshot[SESSION_SHEET] || [];
  if (rows.length < 2) return true;

  const headers = rows[0];
  const patientIdx = headerIndex(headers, "Patient_ID");
  const statusIdx = headerIndex(headers, "Status");
  const nameIdx = headerIndex(headers, "Patient_Name");
  const genderIdx = headerIndex(headers, "Gender");
  const updatedAtIdx = headerIndex(headers, "Updated_At");
  const updatedByIdx = headerIndex(headers, "Updated_By");
  const versionIdx = headerIndex(headers, "Version");
  if (patientIdx < 0 || statusIdx < 0) return false;

  const targetId = normalized(patientId);
  const matching = rows.slice(1)
    .map((row, offset) => ({ row, sheetRow: offset + 2 }))
    .filter(({ row }) => normalized(at(row, patientIdx)) === targetId && ACTIVE_STATUSES.has(normalized(at(row, statusIdx))));

  if (matching.length === 0) return true;
  const now = nowDhaka();

  for (const { row, sheetRow } of matching) {
    const updates: Array<{ index: number; value: string | number }> = [];
    if (hasName && nameIdx >= 0) updates.push({ index: nameIdx, value: normalize(input.fullName) });
    if (hasGender && genderIdx >= 0) updates.push({ index: genderIdx, value: chamberGender(input.gender) });
    if (updatedAtIdx >= 0) updates.push({ index: updatedAtIdx, value: now.display });
    if (updatedByIdx >= 0) updates.push({ index: updatedByIdx, value: staffId });
    if (versionIdx >= 0) updates.push({ index: versionIdx, value: Number(at(row, versionIdx) || 1) + 1 });

    for (const update of updates) {
      await updateSheetValues(
        "physio",
        `'${SESSION_SHEET}'!${columnLetter(update.index)}${sheetRow}`,
        [[update.value]]
      );
    }
  }

  return true;
}
