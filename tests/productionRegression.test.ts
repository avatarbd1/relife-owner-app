import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("staff directory reads production access mapping columns", () => {
  const staff = source("lib/webos/staffDirectory.ts");
  assert.match(staff, /Role_Snapshot/);
  assert.match(staff, /Clinical_Write_Scope/);
  assert.match(staff, /Financial_Access/);
  assert.match(staff, /clinicalByStaff/);
  assert.match(staff, /financialByStaff/);
});

test("cash handover cannot create a negative Reception balance", () => {
  const request = source("app/api/finance/cash/request/route.ts");
  const accept = source("app/api/finance/cash/accept/route.ts");
  for (const value of [request, accept]) {
    assert.match(value, /getScopedCashPosition/);
    assert.match(value, /INSUFFICIENT_RECEPTION_CASH/);
  }
  assert.match(accept, /getPendingCashMovements/);
});

test("dashboard date is explicitly Dhaka local", () => {
  const format = source("lib/format.ts");
  assert.match(format, /timeZone: "Asia\/Dhaka"/);
});

test("Chamber calls are explicit targets and only ring in chamber hours", () => {
  const listener = source("components/ChamberAlertListener.tsx");
  const directCall = source("components/ChamberDirectCall.tsx");
  const layout = source("app/(dashboard)/layout.tsx");
  const chamber = source("app/(dashboard)/chamber/page.tsx");

  assert.match(listener, /CALL:STAFF:/);
  assert.match(listener, /CALL:ROLE:/);
  assert.match(listener, /ALERT_START_HOUR = 9/);
  assert.match(listener, /ALERT_END_HOUR = 21/);
  assert.match(listener, /10_500/);
  assert.match(listener, /requireInteraction: false/);
  assert.match(directCall, /Call the right person/);
  assert.match(directCall, /roomId: `CALL:/);
  assert.match(layout, /currentRoles=\{context\.roles\}/);
  assert.match(chamber, /ChamberDirectCall/);
});
