import test from "node:test";
import assert from "node:assert/strict";
import { paymentErrorResponse } from "../lib/api/paymentErrorResponse.ts";

test("payment authorization denials return 403", async () => {
  for (const message of ["ACCESS_DENIED", "DEPARTMENT_ACCESS_DENIED", "TENANT_SCOPE_DENIED:payment.create"]) {
    const response = paymentErrorResponse(new Error(message));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: message });
  }
});

test("payment validation errors remain 400", () => {
  const response = paymentErrorResponse(new Error("INVALID_AMOUNT"));
  assert.equal(response.status, 400);
});
