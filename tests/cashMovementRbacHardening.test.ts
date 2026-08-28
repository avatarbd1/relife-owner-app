import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const route = source("app/api/control/cash-movement/route.ts");

test("cash approval resolves the authenticated tenant access context and requires Owner before PIN", () => {
  const originCheck = route.indexOf("isAllowedRequestOrigin(request)");
  const sessionCheck = route.indexOf("verifySessionToken(session)");
  const contextResolution = route.indexOf("requireCurrentTenantAccessContext()");
  const ownerGuard = route.indexOf('context.roles.includes("Owner")');
  const bodyRead = route.indexOf("const body = await request.json()");
  const pinCheck = route.indexOf("checkOwnerPin(pin)");
  const writerCall = route.indexOf("await decideCashMovement({");

  for (const index of [originCheck, sessionCheck, contextResolution, ownerGuard, bodyRead, pinCheck, writerCall]) {
    assert.notEqual(index, -1);
  }

  assert(originCheck < sessionCheck);
  assert(sessionCheck < contextResolution);
  assert(contextResolution < ownerGuard);
  assert(ownerGuard < bodyRead);
  assert(bodyRead < pinCheck);
  assert(pinCheck < writerCall);
});

test("non-Owner approval fails closed with 403 before Owner PIN can authorize", () => {
  assert.match(
    route,
    /if \(!context\.roles\.includes\("Owner"\)\) \{[\s\S]*?error: "ACCESS_DENIED"[\s\S]*?status: 403[\s\S]*?\}/
  );

  const ownerGuard = route.indexOf('if (!context.roles.includes("Owner"))');
  const pinGuard = route.indexOf("if (!pin || !checkOwnerPin(pin))");
  assert(ownerGuard >= 0 && pinGuard > ownerGuard);
});

test("missing tenant access context also fails closed with 403", () => {
  assert.match(
    route,
    /try \{[\s\S]*?requireCurrentTenantAccessContext\(\)[\s\S]*?\} catch \(error\) \{[\s\S]*?status: 403/
  );
});

test("Owner PIN remains a secondary confirmation and wrong PIN returns 401", () => {
  assert.match(
    route,
    /if \(!pin \|\| !checkOwnerPin\(pin\)\) \{[\s\S]*?error: "Incorrect PIN"[\s\S]*?status: 401[\s\S]*?\}/
  );
});

test("authenticated Owner staff ID is the canonical audit actor", () => {
  assert.match(route, /actorId: context\.staffId/);
  assert.doesNotMatch(route, /OWNER_DISPLAY_NAME/);
  assert.doesNotMatch(route, /actorId:\s*"Owner"/);
});

test("decideCashMovement remains the sole cash-decision writer in the route", () => {
  const calls = route.match(/decideCashMovement\s*\(/g) ?? [];
  assert.equal(calls.length, 1);
  assert.match(route, /import \{ decideCashMovement \} from "@\/lib\/domain\/finance\/production"/);
});

test("existing workbook, decision and received-amount guards remain intact", () => {
  assert.match(route, /\["physio", "dental"\]/);
  assert.match(route, /\["accept", "reject"\]/);
  assert.match(route, /!Number\.isFinite\(receivedAmount\) \|\| receivedAmount < 0/);
  assert.match(route, /CONTROL_NOT_FOUND/);
  assert.match(route, /CONTROL_ALREADY_DECIDED/);
  assert.match(route, /FINANCE_DB_UNAVAILABLE/);
});

test("successful path passes only validated decision data plus authenticated actor to canonical writer", () => {
  assert.match(
    route,
    /await decideCashMovement\(\{[\s\S]*?workbook: workbook as Workbook,[\s\S]*?movementId: id,[\s\S]*?decision,[\s\S]*?receivedAmount,[\s\S]*?actorId: context\.staffId[\s\S]*?\}\)/
  );
});
