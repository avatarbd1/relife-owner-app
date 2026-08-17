import "server-only";

import { fetchSheetRanges } from "@/lib/data/googleSheets";
import {
  calculateDailyClinicalActivity,
  type DailyClinicalActivity,
} from "@/lib/domain/clinical/dailyActivity";
import type { Scope } from "@/lib/types";

export async function getDailyClinicalActivity(
  scope: Scope,
  date: string
): Promise<DailyClinicalActivity> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");

  const needPhysio = scope === "combined" || scope === "physio";
  const needDental = scope === "combined" || scope === "dental";
  const [physio, dental] = await Promise.all([
    needPhysio
      ? fetchSheetRanges("physio", ["05_Treatments"])
      : Promise.resolve({} as Record<string, string[][]>),
    needDental
      ? fetchSheetRanges("dental", ["05_Treatments"])
      : Promise.resolve({} as Record<string, string[][]>),
  ]);

  return calculateDailyClinicalActivity(
    physio["05_Treatments"] || [],
    dental["05_Treatments"] || [],
    scope,
    date
  );
}
