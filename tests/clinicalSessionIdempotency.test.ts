import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  remarksEndWithSessionRequest,
  sessionRequestMarker,
} from "../lib/domain/clinical/sessionRequest.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * Batch 2 verified defect: recordTreatmentSession had no requestId or
 * duplicate-detection, unlike the sibling Dental clinical writer
 * (addDentalTreatmentNote / DENTALREQ marker) and the salary writer
 * (WEBREQ marker). A lost response on a flaky mobile connection followed
 * by a client retry created a second 05_Treatments row and double-advanced
 * Sessions_Done on the active plan. This mirrors the existing canonical
 * DENTALREQ pattern instead of inventing a new mechanism.
 */
test("session request markers validate IDs and match only the final exact token", () => {
  const marker = sessionRequestMarker("session_12345678");
  assert.equal(marker, "SESSIONREQ:session_12345678");
  assert.equal(remarksEndWithSessionRequest(`Good response | ${marker}`, marker), true);
  assert.equal(
    remarksEndWithSessionRequest(`Good response | ${marker}_another`, marker),
    false,
    "a request ID prefix must not match a different request"
  );
  assert.equal(
    remarksEndWithSessionRequest(`${marker} | SESSIONREQ:actual_request`, marker),
    false,
    "free-text remarks must not impersonate the appended final marker"
  );
  assert.throws(() => sessionRequestMarker("short"), /SESSION_REQUEST_ID_INVALID/);
  assert.throws(
    () => sessionRequestMarker("contains spaces"),
    /SESSION_REQUEST_ID_INVALID/
  );
});

test("Physio session retry reuses one request ID on the canonical locked writer", () => {
  const clinical = source("lib/webos/clinical.ts");
  const route = source("app/api/clinical/session/route.ts");
  const client = source("components/ClinicalWorkspaceClient.tsx");

  assert.match(clinical, /sessionRequestMarker\(input\.requestId\)/);
  assert.match(clinical, /remarksEndWithSessionRequest/);
  assert.match(clinical, /duplicate: true/);
  assert.match(clinical, /duplicate: false/);

  assert.match(route, /withMutationLock\(`patient:Physio:\$\{patientId\}`/);
  assert.match(route, /requestId: body\.requestId/);

  assert.match(client, /const requestIdRef = useRef\(""\)/);
  assert.match(client, /if \(!requestIdRef\.current\) requestIdRef\.current = nextRequestId\(\)/);
  assert.match(client, /requestId: requestIdRef\.current/);
  assert.match(client, /duplicate submit blocked/);
});

test("duplicate session retry does not double-consume inventory", () => {
  const route = source("app/api/clinical/session/route.ts");
  assert.match(route, /if \(!result\.duplicate\) \{/);
  assert.match(route, /consumePhysioInventorySystem/);
});

test("duplicate-check patient/marker lookup happens before a new session is created", () => {
  const clinical = source("lib/webos/clinical.ts");
  const duplicateCheckIndex = clinical.indexOf("existingRequest");
  const sessionNoComputeIndex = clinical.indexOf(
    "const sessionNo = sessions.filter((row) => row.planId === activePlan.planId).length + 1"
  );
  assert.notEqual(duplicateCheckIndex, -1);
  assert.notEqual(sessionNoComputeIndex, -1);
  assert.ok(
    duplicateCheckIndex < sessionNoComputeIndex,
    "duplicate lookup must return before a new session number/row is computed"
  );
});
