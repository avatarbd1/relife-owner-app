import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Owner primary navigation promotes Finance and keeps More secondary", () => {
  const nav = source("components/BottomNav.tsx");
  assert.match(nav, /href: "\/finance"/);
  assert.match(nav, /label: "Finance"/);
  assert.match(nav, /roles\.includes\("Owner"\)/);
  assert.doesNotMatch(
    nav,
    /href: "\/more"[\s\S]*matches: \[[\s\S]*"\/finance"/,
    "Finance routes must not be owned by More"
  );
});

test("More is no longer a duplicate operations home", () => {
  const more = source("app/(dashboard)/more/page.tsx");
  for (const forbidden of [
    'href="/chamber"',
    'href="/daily"',
    'href="/register"',
    'href="/finance"',
    'href="/salary"',
  ]) {
    assert.equal(more.includes(forbidden), false, `${forbidden} should not be in More`);
  }
  assert.match(more, /Reports & analysis/);
  assert.match(more, /Security/);
  assert.match(more, /Audit log/);
  assert.match(more, /Settings/);
});

test("Home quick actions route to semantic workspaces", () => {
  const home = source("app/(dashboard)/home/page.tsx");
  assert.match(home, /href="\/payments"/);
  assert.match(home, /href="\/expenses"/);
  assert.match(home, /href="\/appointments\/new"/);
  assert.doesNotMatch(home, /QuickButton href="\/operations"/);
  assert.match(home, /href="\/finance#approvals"/);
});

test("Legacy finance routes are redirect-only compatibility adapters", () => {
  const operations = source("app/(dashboard)/operations/page.tsx");
  const expenses = source("app/(dashboard)/expenses/page.tsx");
  const canonical = source("app/(dashboard)/finance/operations/page.tsx");

  assert.match(operations, /redirect\(/);
  assert.match(operations, /\/finance\/operations/);
  assert.doesNotMatch(operations, /FinanceOperationsClient/);
  assert.match(expenses, /\/finance\/operations\?tab=expenses/);
  assert.match(canonical, /FinanceOperationsClient/);
});

test("Chamber is organized around Schedule Live Team", () => {
  const chamber = source("app/(dashboard)/chamber/page.tsx");
  const tabs = source("components/ChamberWorkspaceTabs.tsx");
  assert.match(chamber, /ChamberWorkspaceTabs/);
  assert.match(chamber, /activeTab=\{activeTab\}/);
  assert.match(chamber, /panel=\{panel\}/);
  assert.match(tabs, /label: "Schedule"/);
  assert.match(tabs, /label: "Live"/);
  assert.match(tabs, /label: "Team"/);
  assert.doesNotMatch(chamber, /ChamberReservationPanel/);
  assert.doesNotMatch(chamber, /ChamberPatientEditPanel/);
  assert.equal(
    existsSync(new URL("../components/ChamberNav.tsx", import.meta.url)),
    false
  );
});

test("Chamber loads only the active workspace data", () => {
  const chamber = source("app/(dashboard)/chamber/page.tsx");
  const tabs = source("components/ChamberWorkspaceTabs.tsx");
  assert.match(chamber, /if \(activeTab === "schedule"\)/);
  assert.match(chamber, /else if \(activeTab === "live"\)/);
  assert.match(chamber, /getHourlyBedBoard\(context, selectedDate\)/);
  assert.match(chamber, /getChamberCommsSnapshot\(context\)/);
  assert.doesNotMatch(
    chamber,
    /\[rawSnapshot, staffDirectory, comms, hourlyAppointments, visiblePatients\]/
  );
  assert.doesNotMatch(tabs, /useState/);
});

test("Chamber hourly board is owned by the Chamber domain", () => {
  const chamber = source("app/(dashboard)/chamber/page.tsx");
  const board = source("lib/domain/chamber/board.ts");
  const legacy = source("lib/webos/chamberHourlyBooking.ts");

  assert.match(chamber, /@\/lib\/domain\/chamber\/board/);
  assert.doesNotMatch(chamber, /@\/lib\/webos\/chamberHourlyBooking/);
  assert.match(board, /fetchSheetRanges/);
  assert.match(board, /export async function getHourlyBedBoard/);
  assert.match(legacy, /@\/lib\/domain\/chamber\/board/);
  assert.doesNotMatch(legacy, /fetchSheetRanges/);
});
