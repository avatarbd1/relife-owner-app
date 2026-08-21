import "server-only";

import { getPatients, patientsInScope } from "@/lib/patients";
import type { Scope } from "@/lib/types";

/**
 * P0-05 Finance Truth: Billing Contracts
 *
 * Billed Services = sum(02_Patients.Total_Bill) by department/scope
 * Outstanding = sum(02_Patients.Due) by department/scope
 *
 * These metrics come from canonical patient billing state, NOT calculated from treatments.
 *
 * Safety: Completeness check required. If historical billing data is incomplete,
 * both metrics return Unavailable state (not fake ৳0).
 */

export interface BillingMetrics {
  billedServices: number | null; // null = Unavailable
  outstanding: number | null; // null = Unavailable
  completenessState: "verified" | "incomplete" | "unavailable";
  message: string;
}

/**
 * Check if patient billing data is complete/audited.
 * Current criteria (conservative):
 * - At least 2 patient records exist with non-zero billing
 * - No rows with Total_Bill=0 but Paid>0 (cash without service)
 * - Average Total_Bill > 0 (suggests active billing)
 */
function checkBillingCompleteness(rows: Array<{ totalBill: number; paid: number; due: number }>): "verified" | "incomplete" {
  if (rows.length === 0) return "incomplete";

  let nonZeroBillCount = 0;
  let hasAnomalies = false;

  for (const row of rows) {
    if (row.totalBill > 0) nonZeroBillCount += 1;
    if (row.totalBill === 0 && row.paid > 0) hasAnomalies = true;
  }

  if (nonZeroBillCount < 2) return "incomplete";
  if (hasAnomalies) return "incomplete";

  return "verified";
}

/**
 * Get Billed Services and Outstanding metrics by scope.
 * Returns null for each metric if billing data is incomplete.
 */
export async function getBillingMetrics(scope: Scope): Promise<BillingMetrics> {
  try {
    const allPatients = await getPatients();
    const scoped = patientsInScope(allPatients, scope);

    const completenessState = checkBillingCompleteness(
      scoped.map((p) => ({
        totalBill: p.totalBill,
        paid: p.paid,
        due: p.due,
      }))
    );

    if (completenessState === "incomplete") {
      return {
        billedServices: null,
        outstanding: null,
        completenessState: "incomplete",
        message: "Incomplete billing history — unable to calculate billed services and outstanding",
      };
    }

    const billedServices = scoped.reduce((sum, p) => sum + p.totalBill, 0);
    const outstanding = scoped.reduce((sum, p) => sum + p.due, 0);

    return {
      billedServices,
      outstanding,
      completenessState: "verified",
      message: "Billing metrics verified from patient records",
    };
  } catch (error) {
    return {
      billedServices: null,
      outstanding: null,
      completenessState: "unavailable",
      message: `Billing data unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
