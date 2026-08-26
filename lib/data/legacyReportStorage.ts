import "server-only";

import type { Workbook } from "@/lib/data/googleSheets";

/**
 * Legacy report-storage roots are Google Sheets/storage ledger identities, not
 * canonical Supabase tenant IDs. Keep them at the data compatibility boundary.
 */
export function legacyReportStorageRoot(workbook: Workbook): string {
  return workbook === "dental" ? "RELIFE-DENTAL" : "RELIFE-PHYSIO";
}
