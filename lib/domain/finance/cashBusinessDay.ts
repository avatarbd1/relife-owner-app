const DHAKA_TIME_ZONE = "Asia/Dhaka";

/**
 * Cash custody became an explicit ledger from the August 2026 cutover.
 * July is retained as legacy reporting data and must not silently become
 * August opening Reception cash.
 */
export const CASH_CUSTODY_LEDGER_START_DATE = "2026-08-01";
export const CASH_BUSINESS_DAY_START_HOUR = 9;

function dhakaParts(ref: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DHAKA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ref);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
  };
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function previousCalendarDate(year: number, month: number, day: number): string {
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

/**
 * Relife's clinic cash business day starts at 09:00 Asia/Dhaka.
 * Example: 2026-08-17 04:55 Dhaka belongs to business date 2026-08-16.
 * Audit/request timestamps remain the real clock time elsewhere.
 */
export function cashBusinessDate(ref: Date = new Date()): string {
  const parts = dhakaParts(ref);
  if (parts.hour < CASH_BUSINESS_DAY_START_HOUR) {
    return previousCalendarDate(parts.year, parts.month, parts.day);
  }
  return dateKey(parts.year, parts.month, parts.day);
}

/**
 * Convert a timestamp written in the live Sheets Dhaka-local formats into the
 * same 09:00 cash business date used by the custody ledger. Explicit ISO
 * timestamps with an offset/Z are also accepted. Date-only or unknown legacy
 * values fail back to the supplied ledger date rather than inventing a time.
 */
export function cashBusinessDateFromTimestamp(
  value: string | undefined,
  fallbackDate: string
): string {
  const fallback = String(fallbackDate || "").trim().slice(0, 10);
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return cashBusinessDate(parsed);
  }

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i
  );
  if (!match) return fallback;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!match[4]) return dateKey(year, month, day);

  let hour = Number(match[4]);
  const meridiem = String(match[6] || "").toUpperCase();
  if (meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return fallback;
  if (hour < CASH_BUSINESS_DAY_START_HOUR) {
    return previousCalendarDate(year, month, day);
  }
  return dateKey(year, month, day);
}

export function isCashCustodyLedgerDate(
  value: string | undefined,
  asOfDate: string
): boolean {
  const key = String(value || "").trim().slice(0, 10);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(key) &&
    key >= CASH_CUSTODY_LEDGER_START_DATE &&
    key <= asOfDate
  );
}
