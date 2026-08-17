export type MonthSegment = {
  ref: Date;
  days: number;
  daysInMonth: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertValidDateRange(startDate: string, endDate: string): void {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
    throw new Error("INVALID_DATE_RANGE");
  }
}

export function dateRangeMonthSegments(startDate: string, endDate: string): MonthSegment[] {
  assertValidDateRange(startDate, endDate);

  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const rangeEnd = Date.UTC(endYear, endMonth - 1, endDay);
  let cursor = Date.UTC(startYear, startMonth - 1, startDay);
  const segments: MonthSegment[] = [];

  while (cursor <= rangeEnd) {
    const cursorDate = new Date(cursor);
    const year = cursorDate.getUTCFullYear();
    const monthIndex = cursorDate.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const monthEnd = Date.UTC(year, monthIndex, daysInMonth);
    const segmentEnd = Math.min(monthEnd, rangeEnd);
    const days = Math.floor((segmentEnd - cursor) / 86_400_000) + 1;

    segments.push({
      ref: new Date(Date.UTC(year, monthIndex, 15, 12)),
      days,
      daysInMonth,
    });
    cursor = segmentEnd + 86_400_000;
  }

  return segments;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function prorateMonthlyAmount(monthlyAmount: number, segments: MonthSegment[]): number {
  return roundMoney(
    segments.reduce(
      (sum, segment) => sum + (monthlyAmount * segment.days) / segment.daysInMonth,
      0
    )
  );
}
