export type RelifeDepartment = "Physio" | "Dental";
export type RelifeWorkbook = "physio" | "dental";

export const RELIFE_SYSTEM = {
  organizationId: "RELIFE",
  branchId: "AMTALI-01",
  timeZone: "Asia/Dhaka",
  sourceSystem: "web_pwa",
  sourceType: "human_entry",
  schemaVersion: "relife-uda-v1",
} as const;

/**
 * Supabase tenant scope is deliberately separate from the legacy Sheets ledger
 * identities below. The slugs resolve to UUID primary keys inside Postgres.
 */
export const RELIFE_SUPABASE_SCOPE = {
  organizationSlug: "relife",
  clinicSlug: "amtali-main",
} as const;

const DEPARTMENT_CONFIG = {
  Physio: {
    workbook: "physio",
    ledgerClinicId: "RELIFE-PHYSIO",
  },
  Dental: {
    workbook: "dental",
    ledgerClinicId: "RELIFE-DENTAL",
  },
} as const satisfies Record<
  RelifeDepartment,
  { workbook: RelifeWorkbook; ledgerClinicId: string }
>;

/**
 * Existing `RELIFE-PHYSIO` / `RELIFE-DENTAL` values are ledger identities used
 * by the current Sheets schema. They are not future multi-tenant primary keys.
 */
export function ledgerClinicId(department: RelifeDepartment): string {
  return DEPARTMENT_CONFIG[department].ledgerClinicId;
}

export function workbookForDepartment(
  department: RelifeDepartment
): RelifeWorkbook {
  return DEPARTMENT_CONFIG[department].workbook;
}

export function departmentForWorkbook(
  workbook: RelifeWorkbook
): RelifeDepartment {
  return workbook === "dental" ? "Dental" : "Physio";
}

export function relifeRecordId(
  department: RelifeDepartment,
  entityId: string
): string {
  return `${ledgerClinicId(department)}:${entityId}`;
}

export function dhakaClockParts(ref = new Date()): {
  date: string;
  time: string;
  timestamp: string;
  provenance: string;
} {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RELIFE_SYSTEM.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const values = Object.fromEntries(
    dateParts.map((part) => [part.type, part.value])
  );
  const date = `${values.year}-${values.month}-${values.day}`;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: RELIFE_SYSTEM.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(ref);
  return {
    date,
    time,
    timestamp: `${date} ${time}`,
    provenance: ref.toISOString(),
  };
}
