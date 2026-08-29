/**
 * Appointment time conversion.
 *
 * The operational core stores a start time as minutes from midnight, so
 * ordering and overlap are arithmetic rather than parsing a display string.
 * Callers speak two other forms: the `HH:mm` an HTML time input produces, and
 * the `h:mm AM/PM` the clinic reads. These conversions are pure and carry no
 * server or storage dependency, so both the adapter and its tests can use them.
 */

/** Minutes from midnight -> the `h:mm AM/PM` display form. */
export function displayTimeFromMinute(minute: number): string {
  const safe = Number.isFinite(minute) ? Math.max(0, Math.min(1439, Math.trunc(minute))) : 0;
  const hour24 = Math.floor(safe / 60);
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(safe % 60).padStart(2, "0")} ${suffix}`;
}

/** `HH:mm` -> minutes from midnight. Rejects anything it cannot read exactly. */
export function minuteFromInputTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) throw new Error("INVALID_TIME");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("INVALID_TIME");
  return hour * 60 + minute;
}

/** `h:mm AM/PM` -> minutes from midnight, for reading back a display value. */
export function minuteFromDisplayTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value || "").trim());
  if (!match) throw new Error("INVALID_TIME");
  const minute = Number(match[2]);
  if (minute > 59) throw new Error("INVALID_TIME");
  const rawHour = Number(match[1]);
  if (rawHour < 1 || rawHour > 12) throw new Error("INVALID_TIME");
  const hour = rawHour % 12;
  return (match[3].toUpperCase() === "PM" ? hour + 12 : hour) * 60 + minute;
}
