#!/usr/bin/env node
/**
 * Batch 4A production-closure preparation tool (issue #153).
 *
 * Preflight/provisioning for the two approved-but-not-yet-created Sheets
 * tabs: Staff_Shifts and Leave_Requests, in the "physio" workbook. This
 * script only ever:
 *   - creates missing tabs and their exact reviewed header rows in one
 *     atomic spreadsheets.batchUpdate request;
 *   - reports (and, in --apply mode, refuses to write past) a header
 *     mismatch on an already-existing tab.
 *
 * It NEVER deletes, renames, clears, reorders, or overwrites an existing
 * tab, and it never writes a data row. It is a standalone CLI only — no
 * application route imports or invokes it.
 *
 * Modes (the `--conditions=react-server` flag is required every time: this
 * script imports lib/data/googleSheets.ts, which is marked "server-only" —
 * that marker package throws unless the "react-server" export condition is
 * set, which Next.js sets implicitly but a standalone Node CLI does not):
 *
 *   node --conditions=react-server scripts/workforce-schema-provision.mjs
 *     Dry-run (default). Reads live sheet properties/headers, prints the
 *     plan, makes zero writes. Exit 0 if nothing is blocking, exit 1 if a
 *     header mismatch is found (still zero writes either way).
 *
 *   node --conditions=react-server scripts/workforce-schema-provision.mjs --apply
 *     Live apply. Requires the exact spreadsheet-bound confirmation value
 *     printed by the dry run in addition to the flag. Creates only the
 *     missing tab(s) and writes only their exact reviewed header row.
 *     Refuses (zero writes) if any existing tab's headers mismatch, or if
 *     the confirmation value is absent/wrong.
 *
 * This script is never executed against live Sheets from this artifact-
 * building task (this sandbox has no Sheets credentials configured at all —
 * confirmed by running it here, which failed closed on the credentials
 * check with zero writes). It is delivered as reviewed, tested code for the
 * Owner to run later as a separately controlled operation.
 */

import {
  buildWorkforceProvisioningBatch,
  planWorkforceProvisioning,
  headerRowRange,
  workforceApplyConfirmation,
  WORKFORCE_PROVISION_WORKBOOK,
} from "../lib/domain/workforce/provisioning.ts";
import { pathToFileURL } from "node:url";

const CONFIRM_ENV_VAR = "WORKFORCE_SCHEMA_APPLY_CONFIRM";

function actionLabel(action) {
  if (action === "create") return "CREATE (new empty tab + header row)";
  if (action === "noop") return "OK (headers already match, no write)";
  return "MISMATCH (existing headers differ, fail-closed)";
}

function printPlan(plan, spreadsheetId) {
  console.log(`Target workbook alias: ${plan.workbook}`);
  console.log(`Resolved spreadsheet ID: ${spreadsheetId}`);
  for (const tab of plan.tabs) {
    console.log(`- ${tab.tabName}: ${actionLabel(tab.action)}`);
    if (tab.action === "mismatch" && tab.mismatch) {
      if (tab.mismatch.missing.length > 0) {
        console.log(`    missing headers: ${tab.mismatch.missing.join(", ")}`);
      }
      if (tab.mismatch.unexpected.length > 0) {
        console.log(`    unexpected headers: ${tab.mismatch.unexpected.join(", ")}`);
      }
      if (tab.mismatch.reordered) {
        console.log("    headers present but out of the reviewed order");
      }
    }
  }
}

async function loadLivePlan() {
  // Imported lazily so a pure dry-run of the CLI's argument/confirmation
  // handling never requires Sheets credentials to be configured, and so
  // tests can exercise everything above this line without network access.
  const { getSheetProperties, fetchSheetRanges, getWorkbookSpreadsheetId } = await import(
    "../lib/data/googleSheets.ts"
  );
  const { WORKFORCE_PROVISION_TARGETS } = await import(
    "../lib/domain/workforce/provisioning.ts"
  );

  const spreadsheetId = getWorkbookSpreadsheetId(WORKFORCE_PROVISION_WORKBOOK);
  const properties = await getSheetProperties(WORKFORCE_PROVISION_WORKBOOK);
  const existingTitles = properties.map((item) => item.title);

  const presentTargets = WORKFORCE_PROVISION_TARGETS.filter((target) =>
    existingTitles.includes(target.tabName)
  );
  const headerRanges = presentTargets.map((target) =>
    headerRowRange(target.tabName)
  );
  const snapshot =
    headerRanges.length > 0
      ? await fetchSheetRanges(WORKFORCE_PROVISION_WORKBOOK, headerRanges)
      : {};

  const headersByTitle = {};
  for (const target of presentTargets) {
    const range = headerRowRange(target.tabName);
    const rows = snapshot[range] || [];
    headersByTitle[target.tabName] = rows[0];
  }

  return {
    plan: planWorkforceProvisioning({ existingTitles, headersByTitle }),
    properties,
    spreadsheetId,
  };
}

export async function applyPlan(plan, properties, batchUpdate) {
  const writeBatch = batchUpdate ?? (await import("../lib/data/googleSheets.ts"))
    .batchUpdateSpreadsheet;
  const batch = buildWorkforceProvisioningBatch({ plan, existingSheets: properties });
  await writeBatch(WORKFORCE_PROVISION_WORKBOOK, batch.requests);
  for (const tab of batch.createdTabs) {
    console.log(`Created ${tab.tabName} with its reviewed header row (sheetId ${tab.sheetId}).`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { plan, properties, spreadsheetId } = await loadLivePlan();
  printPlan(plan, spreadsheetId);

  if (plan.hasBlockingMismatch) {
    console.error(
      "One or more existing tabs have headers that differ from the reviewed " +
        "schema. Zero writes performed. Resolve the mismatch manually before " +
        "re-running."
    );
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(
      plan.hasPendingCreate
        ? "Dry-run only: pass --apply with the confirmation env var to create the missing tab(s)."
        : "Dry-run only: schema already matches, nothing to do."
    );
    return;
  }

  const expectedConfirmation = workforceApplyConfirmation(spreadsheetId);
  if (process.env[CONFIRM_ENV_VAR] !== expectedConfirmation) {
    console.error(
      `Refusing to apply: set ${CONFIRM_ENV_VAR}="${expectedConfirmation}" ` +
        "to bind approval to the resolved spreadsheet and reviewed tab set. Zero writes performed."
    );
    process.exitCode = 1;
    return;
  }

  if (!plan.hasPendingCreate) {
    console.log("Apply: schema already matches, nothing to do (idempotent no-op).");
    return;
  }

  await applyPlan(plan, properties);
  console.log("Apply complete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Workforce schema provisioning failed:", error?.message || error);
    process.exitCode = 1;
  });
}
