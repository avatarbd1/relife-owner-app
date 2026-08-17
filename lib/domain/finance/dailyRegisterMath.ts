export interface DailyDueSnapshot {
  receiptNo: string;
  patientId: string;
  patientName: string;
  due: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Daily payment rows are transaction rows, but Due is a post-payment balance
 * snapshot. Multiple payments by the same patient must therefore contribute
 * only the latest Due snapshot to the register summary.
 */
export function totalLatestPatientDue(rows: DailyDueSnapshot[]): number {
  const latest = new Map<string, number>();
  for (const row of rows) {
    const patientId = String(row.patientId || "").trim();
    const patientName = normalized(row.patientName);
    const receiptNo = String(row.receiptNo || "").trim();
    const key = patientId
      ? `id:${patientId}`
      : patientName
        ? `name:${patientName}`
        : `receipt:${receiptNo}`;
    latest.set(key, Math.max(0, Number(row.due) || 0));
  }
  return [...latest.values()].reduce((sum, due) => sum + due, 0);
}
