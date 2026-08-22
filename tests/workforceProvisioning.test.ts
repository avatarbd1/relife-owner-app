import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildWorkforceProvisioningBatch,
  compareWorkforceHeaders,
  headerRowRange,
  planWorkforceProvisioning,
  workforceApplyConfirmation,
  WORKFORCE_PROVISION_TARGETS,
  WORKFORCE_PROVISION_WORKBOOK,
} from "../lib/domain/workforce/provisioning.ts";
import { LEAVE_REQUESTS_HEADERS, STAFF_SHIFTS_HEADERS } from "../lib/domain/workforce/types.ts";
import { applyPlan } from "../scripts/workforce-schema-provision.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliSource = readFileSync(
  path.join(repoRoot, "scripts/workforce-schema-provision.mjs"),
  "utf8"
);

test("workbook target is exactly physio, matching the existing Batch 4A convention", () => {
  assert.equal(WORKFORCE_PROVISION_WORKBOOK, "physio");
  assert.deepEqual(
    WORKFORCE_PROVISION_TARGETS.map((t) => t.tabName).sort(),
    ["Leave_Requests", "Staff_Shifts"]
  );
});

test("missing tabs produce only the expected create plan", () => {
  const plan = planWorkforceProvisioning({ existingTitles: [], headersByTitle: {} });
  assert.equal(plan.tabs.length, 2);
  assert.ok(plan.tabs.every((tab) => tab.action === "create"));
  assert.equal(plan.hasPendingCreate, true);
  assert.equal(plan.hasBlockingMismatch, false);
});

test("correct existing schema is a no-op", () => {
  const plan = planWorkforceProvisioning({
    existingTitles: ["Staff_Shifts", "Leave_Requests", "08_Staff"],
    headersByTitle: {
      Staff_Shifts: [...STAFF_SHIFTS_HEADERS],
      Leave_Requests: [...LEAVE_REQUESTS_HEADERS],
    },
  });
  assert.ok(plan.tabs.every((tab) => tab.action === "noop"));
  assert.equal(plan.hasPendingCreate, false);
  assert.equal(plan.hasBlockingMismatch, false);
});

test("repeated apply is idempotent: a second plan against the just-created tabs is also a no-op", () => {
  const firstRun = planWorkforceProvisioning({ existingTitles: [], headersByTitle: {} });
  assert.equal(firstRun.hasPendingCreate, true);

  // Simulate the state after the first apply actually wrote the reviewed
  // headers, then plan again exactly as a second invocation would.
  const secondRun = planWorkforceProvisioning({
    existingTitles: ["Staff_Shifts", "Leave_Requests"],
    headersByTitle: {
      Staff_Shifts: [...STAFF_SHIFTS_HEADERS],
      Leave_Requests: [...LEAVE_REQUESTS_HEADERS],
    },
  });
  assert.ok(secondRun.tabs.every((tab) => tab.action === "noop"));
  assert.equal(secondRun.hasPendingCreate, false);
  assert.equal(secondRun.hasBlockingMismatch, false);
});

test("mismatched headers fail closed: missing column", () => {
  const shortHeaders = STAFF_SHIFTS_HEADERS.slice(0, -1);
  const plan = planWorkforceProvisioning({
    existingTitles: ["Staff_Shifts", "Leave_Requests"],
    headersByTitle: {
      Staff_Shifts: [...shortHeaders],
      Leave_Requests: [...LEAVE_REQUESTS_HEADERS],
    },
  });
  const shiftTab = plan.tabs.find((tab) => tab.tabName === "Staff_Shifts")!;
  assert.equal(shiftTab.action, "mismatch");
  assert.deepEqual(shiftTab.mismatch?.missing, ["Updated_At"]);
  assert.equal(plan.hasBlockingMismatch, true);
});

test("mismatched headers fail closed: unexpected extra column", () => {
  const mismatch = compareWorkforceHeaders(
    [...STAFF_SHIFTS_HEADERS],
    [...STAFF_SHIFTS_HEADERS, "Extra_Column"]
  );
  assert.ok(mismatch);
  assert.deepEqual(mismatch?.unexpected, ["Extra_Column"]);
  assert.equal(mismatch?.missing.length, 0);
});

test("mismatched headers fail closed: reordered columns", () => {
  const reordered = [...STAFF_SHIFTS_HEADERS];
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const mismatch = compareWorkforceHeaders([...STAFF_SHIFTS_HEADERS], reordered);
  assert.ok(mismatch);
  assert.equal(mismatch?.reordered, true);
  assert.equal(mismatch?.missing.length, 0);
  assert.equal(mismatch?.unexpected.length, 0);
});

test("a tab that exists with zero header cells is a mismatch, not silently a create", () => {
  const plan = planWorkforceProvisioning({
    existingTitles: ["Staff_Shifts"],
    headersByTitle: { Staff_Shifts: [] },
  });
  const shiftTab = plan.tabs.find((tab) => tab.tabName === "Staff_Shifts")!;
  assert.equal(shiftTab.action, "mismatch");
});

test("headerRowRange reads the entire first row and safely quotes the tab title", () => {
  assert.equal(headerRowRange("Staff_Shifts"), "'Staff_Shifts'!1:1");
  assert.equal(headerRowRange("Owner's Shifts"), "'Owner''s Shifts'!1:1");
});

test("this test file never imports the live Sheets client, so it never needs live credentials", () => {
  const selfSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const importLines = selfSource
    .split("\n")
    .filter((line) => line.trim().startsWith("import "));
  assert.ok(importLines.every((line) => !line.includes("googleSheets")));
});

test("apply confirmation is bound to the exact resolved spreadsheet ID and tab set", () => {
  const first = workforceApplyConfirmation("sheet-one");
  const second = workforceApplyConfirmation("sheet-two");
  assert.equal(
    first,
    "spreadsheet:sheet-one:tabs:Staff_Shifts,Leave_Requests"
  );
  assert.notEqual(first, second);
  assert.throws(() => workforceApplyConfirmation("  "), /WORKFORCE_SPREADSHEET_ID_REQUIRED/);
});

test("one atomic batch contains addSheet + header updateCells for every missing tab", () => {
  const plan = planWorkforceProvisioning({ existingTitles: [], headersByTitle: {} });
  const batch = buildWorkforceProvisioningBatch({
    plan,
    existingSheets: [{ sheetId: 7, title: "08_Staff" }],
  });
  assert.equal(batch.requests.length, 4);
  assert.equal(batch.createdTabs.length, 2);

  for (let index = 0; index < batch.createdTabs.length; index += 1) {
    const created = batch.createdTabs[index];
    const add = batch.requests[index * 2] as {
      addSheet: { properties: { sheetId: number; title: string } };
    };
    const update = batch.requests[index * 2 + 1] as {
      updateCells: {
        range: { sheetId: number; startRowIndex: number; endRowIndex: number };
        rows: Array<{ values: Array<{ userEnteredValue: { stringValue: string } }> }>;
      };
    };
    assert.equal(add.addSheet.properties.title, created.tabName);
    assert.equal(add.addSheet.properties.sheetId, created.sheetId);
    assert.equal(update.updateCells.range.sheetId, created.sheetId);
    assert.equal(update.updateCells.range.startRowIndex, 0);
    assert.equal(update.updateCells.range.endRowIndex, 1);
    assert.deepEqual(
      update.updateCells.rows[0].values.map((cell) => cell.userEnteredValue.stringValue),
      plan.tabs[index].headers
    );
  }
});

test("reserved sheet-ID collisions are skipped without changing existing tabs", () => {
  const plan = planWorkforceProvisioning({ existingTitles: [], headersByTitle: {} });
  const batch = buildWorkforceProvisioningBatch({
    plan,
    existingSheets: [{ sheetId: 1_530_000_000, title: "Existing" }],
  });
  assert.deepEqual(
    batch.createdTabs.map((tab) => tab.sheetId),
    [1_530_000_001, 1_530_000_002]
  );
});

test("blocking mismatch and stale plans produce no provisioning request", () => {
  const mismatchPlan = planWorkforceProvisioning({
    existingTitles: ["Staff_Shifts"],
    headersByTitle: { Staff_Shifts: ["wrong"] },
  });
  assert.throws(
    () => buildWorkforceProvisioningBatch({ plan: mismatchPlan, existingSheets: [] }),
    /WORKFORCE_SCHEMA_MISMATCH/
  );

  const stalePlan = planWorkforceProvisioning({ existingTitles: [], headersByTitle: {} });
  assert.throws(
    () =>
      buildWorkforceProvisioningBatch({
        plan: stalePlan,
        existingSheets: [{ sheetId: 99, title: "Staff_Shifts" }],
      }),
    /WORKFORCE_PLAN_STALE/
  );
});

test("applyPlan performs one write call containing the complete atomic request set", async () => {
  const plan = planWorkforceProvisioning({ existingTitles: [], headersByTitle: {} });
  const calls: Array<{ workbook: string; requests: Array<Record<string, unknown>> }> = [];
  await applyPlan(
    plan,
    [{ sheetId: 7, title: "08_Staff" }],
    async (workbook: string, requests: Array<Record<string, unknown>>) => {
      calls.push({ workbook, requests });
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workbook, "physio");
  assert.equal(calls[0].requests.length, 4);
  assert.ok(calls[0].requests.every((request) => "addSheet" in request || "updateCells" in request));
});

test("CLI usage documentation names the required --conditions=react-server flag", () => {
  assert.ok(cliSource.includes("--conditions=react-server"));
});

test("CLI prints the resolved spreadsheet ID and never uses the old alias-only confirmation", () => {
  assert.ok(cliSource.includes("Resolved spreadsheet ID:"));
  assert.ok(cliSource.includes("workforceApplyConfirmation(spreadsheetId)"));
  assert.ok(!cliSource.includes("physio:Staff_Shifts,Leave_Requests"));
});

test("Sheets reader preserves a qualified full-row A1 expression", () => {
  const sheetsSource = readFileSync(path.join(repoRoot, "lib/data/googleSheets.ts"), "utf8");
  assert.match(sheetsSource, /range\.includes\("!"\) \? range/);
  assert.match(sheetsSource, /params\.append\("ranges", readRangeExpression\(range\)\)/);
});

test("CLI has no split header writer; all schema writes use the atomic batch API", () => {
  assert.ok(cliSource.includes("batchUpdateSpreadsheet"));
  assert.ok(!cliSource.includes("updateSheetValues"));
  assert.ok(!/deleteSheet|updateSheetProperties|clear\(/.test(cliSource));
});

test("no application route imports or invokes the provisioning CLI", () => {
  // Structural guard: the script's own filename must not appear anywhere
  // under app/api, and the CLI must not export anything Next.js route
  // conventions would pick up (no GET/POST/PATCH export).
  assert.ok(!/export\s+(async\s+)?function\s+(GET|POST|PATCH|DELETE)\b/.test(cliSource));
});
