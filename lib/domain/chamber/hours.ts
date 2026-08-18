export const PHYSIO_CHAMBER_STARTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
] as const;

export const PHYSIO_CHAMBER_BED_IDS = [
  "BED-1",
  "BED-2",
  "BED-3",
  "BED-4",
] as const;

export const PHYSIO_CHAMBER_DAILY_CAPACITY =
  PHYSIO_CHAMBER_STARTS.length * PHYSIO_CHAMBER_BED_IDS.length;

export function chamberStartMinutes(value: string): number {
  const input = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!input) return Number.NaN;
  const hour = Number(input[1]);
  const minute = Number(input[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return Number.NaN;
  return hour * 60 + minute;
}

export function isPhysioChamberStart(value: string): boolean {
  const minute = chamberStartMinutes(value);
  if (!Number.isFinite(minute)) return false;
  return PHYSIO_CHAMBER_STARTS.some(
    (start) => chamberStartMinutes(start) === minute
  );
}

export function isPhysioTreatmentBed(value: string): boolean {
  return (PHYSIO_CHAMBER_BED_IDS as readonly string[]).includes(
    String(value || "").trim()
  );
}
