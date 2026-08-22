import {
  LEAVE_REQUESTS_HEADERS,
  LEAVE_REQUESTS_SHEET,
  STAFF_SHIFTS_HEADERS,
  STAFF_SHIFTS_SHEET,
} from "./types.ts";

/**
 * Pure schema-provisioning planner for the two Batch 4A workforce tabs
 * (issue #153). No I/O here — every function takes plain data in and
 * returns a plan out, so it is fully testable without live Sheets
 * credentials. `scripts/workforce-schema-provision.mjs` is the only caller
 * that performs real reads/writes.
 */

export const WORKFORCE_PROVISION_WORKBOOK = "physio" as const;

export interface WorkforceTabTarget {
  tabName: string;
  headers: readonly string[];
}

export const WORKFORCE_PROVISION_TARGETS: readonly WorkforceTabTarget[] = [
  { tabName: STAFF_SHIFTS_SHEET, headers: STAFF_SHIFTS_HEADERS },
  { tabName: LEAVE_REQUESTS_SHEET, headers: LEAVE_REQUESTS_HEADERS },
];

export interface WorkforceHeaderMismatch {
  missing: string[];
  unexpected: string[];
  reordered: boolean;
}

export type WorkforceTabAction = "create" | "noop" | "mismatch";

export interface WorkforceTabPlan {
  tabName: string;
  action: WorkforceTabAction;
  headers: readonly string[];
  mismatch?: WorkforceHeaderMismatch;
}

export interface WorkforceProvisioningPlan {
  workbook: typeof WORKFORCE_PROVISION_WORKBOOK;
  tabs: WorkforceTabPlan[];
  hasBlockingMismatch: boolean;
  hasPendingCreate: boolean;
}

export interface WorkforceSheetProperty {
  sheetId: number;
  title: string;
}

export interface WorkforceProvisioningBatch {
  requests: Array<Record<string, unknown>>;
  createdTabs: Array<{ tabName: string; sheetId: number }>;
}

const PROVISIONED_SHEET_ID_START = 1_530_000_000;

function normalizeHeaderCell(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Exact-order comparison. A tab whose headers exist but are reordered,
 * missing one, or carry an extra column is a mismatch, not a silent
 * reconciliation — issue #153/task instruction: "if an existing header
 * differs, fail closed and report the exact mismatch."
 */
export function compareWorkforceHeaders(
  expected: readonly string[],
  actual: readonly string[] | undefined
): WorkforceHeaderMismatch | null {
  if (!actual) return null; // handled as "create" by the caller, not a mismatch
  const actualNormalized = actual.map(normalizeHeaderCell);
  const expectedNormalized = expected.map(normalizeHeaderCell);

  const expectedSet = new Set(expectedNormalized);
  const actualSet = new Set(actualNormalized);
  const missing = expectedNormalized.filter((header) => !actualSet.has(header));
  const unexpected = actualNormalized.filter((header) => !expectedSet.has(header));

  let reordered = false;
  if (missing.length === 0 && unexpected.length === 0) {
    reordered = expectedNormalized.some(
      (header, index) => actualNormalized[index] !== header
    );
  }

  if (missing.length === 0 && unexpected.length === 0 && !reordered) {
    return null;
  }
  return { missing, unexpected, reordered };
}

/**
 * `headersByTitle[title]` is the tab's actual row-1 header values when the
 * tab exists, or `undefined` when it does not exist yet (as opposed to an
 * empty array, which means the tab exists but has no header row written —
 * treated the same as a full mismatch: the tab is present but not usable).
 */
export function planWorkforceProvisioning(input: {
  existingTitles: readonly string[];
  headersByTitle: Record<string, readonly string[] | undefined>;
}): WorkforceProvisioningPlan {
  const existing = new Set(input.existingTitles);
  const tabs: WorkforceTabPlan[] = WORKFORCE_PROVISION_TARGETS.map((target) => {
    if (!existing.has(target.tabName)) {
      return { tabName: target.tabName, action: "create", headers: target.headers };
    }
    const actualHeaders = input.headersByTitle[target.tabName];
    const mismatch = compareWorkforceHeaders(target.headers, actualHeaders);
    if (mismatch) {
      return { tabName: target.tabName, action: "mismatch", headers: target.headers, mismatch };
    }
    return { tabName: target.tabName, action: "noop", headers: target.headers };
  });

  return {
    workbook: WORKFORCE_PROVISION_WORKBOOK,
    tabs,
    hasBlockingMismatch: tabs.some((tab) => tab.action === "mismatch"),
    hasPendingCreate: tabs.some((tab) => tab.action === "create"),
  };
}

/**
 * Read the entire first row so a populated column beyond the reviewed schema
 * cannot be hidden by a bounded A:M/A:O request.
 */
export function headerRowRange(tabName: string): string {
  return `'${tabName.replaceAll("'", "''")}'!1:1`;
}

export function workforceApplyConfirmation(spreadsheetId: string): string {
  const normalized = spreadsheetId.trim();
  if (!normalized) throw new Error("WORKFORCE_SPREADSHEET_ID_REQUIRED");
  return `spreadsheet:${normalized}:tabs:${WORKFORCE_PROVISION_TARGETS.map(
    (target) => target.tabName
  ).join(",")}`;
}

function headerCell(value: string): Record<string, unknown> {
  return { userEnteredValue: { stringValue: value } };
}

/**
 * Build one Google Sheets batchUpdate request list. addSheet and updateCells
 * for every missing tab are submitted together, so the API applies the full
 * schema change atomically or applies none of it.
 */
export function buildWorkforceProvisioningBatch(input: {
  plan: WorkforceProvisioningPlan;
  existingSheets: readonly WorkforceSheetProperty[];
}): WorkforceProvisioningBatch {
  if (input.plan.hasBlockingMismatch) {
    throw new Error("WORKFORCE_SCHEMA_MISMATCH");
  }

  const usedSheetIds = new Set(input.existingSheets.map((sheet) => sheet.sheetId));
  const existingTitles = new Set(input.existingSheets.map((sheet) => sheet.title));
  const requests: Array<Record<string, unknown>> = [];
  const createdTabs: Array<{ tabName: string; sheetId: number }> = [];
  let candidateSheetId = PROVISIONED_SHEET_ID_START;

  for (const tab of input.plan.tabs) {
    if (tab.action !== "create") continue;
    if (existingTitles.has(tab.tabName)) {
      throw new Error("WORKFORCE_PLAN_STALE");
    }
    while (usedSheetIds.has(candidateSheetId)) candidateSheetId += 1;
    if (candidateSheetId > 2_147_483_647) {
      throw new Error("WORKFORCE_SHEET_ID_EXHAUSTED");
    }
    const sheetId = candidateSheetId;
    usedSheetIds.add(sheetId);
    candidateSheetId += 1;

    requests.push({ addSheet: { properties: { sheetId, title: tab.tabName } } });
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: tab.headers.length,
        },
        rows: [{ values: tab.headers.map(headerCell) }],
        fields: "userEnteredValue",
      },
    });
    createdTabs.push({ tabName: tab.tabName, sheetId });
  }

  return { requests, createdTabs };
}
