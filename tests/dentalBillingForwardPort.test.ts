import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyDentalTreatmentCharge } from "../lib/domain/clinical/dentalBilling.ts";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dental charge increases total bill and due", () => {
  assert.deepEqual(
    applyDentalTreatmentCharge({ totalBill: 0, due: 0, advanceBalance: 0 }, 3000),
    {
      newTotalBill: 3000,
      newDue: 3000,
      newAdvanceBalance: 0,
      advanceApplied: 0,
      paymentStatus: "Due",
    }
  );
});

test("zero-charge follow-up preserves billing state", () => {
  assert.deepEqual(
    applyDentalTreatmentCharge({ totalBill: 5000, due: 2000, advanceBalance: 0 }, 0),
    {
      newTotalBill: 5000,
      newDue: 2000,
      newAdvanceBalance: 0,
      advanceApplied: 0,
      paymentStatus: "Due",
    }
  );
});

test("existing advance is consumed before new due", () => {
  assert.deepEqual(
    applyDentalTreatmentCharge({ totalBill: 5000, due: 3000, advanceBalance: 2000 }, 2000),
    {
      newTotalBill: 7000,
      newDue: 3000,
      newAdvanceBalance: 0,
      advanceApplied: 2000,
      paymentStatus: "Due",
    }
  );
});

test("advance can fully cover a new charge", () => {
  assert.deepEqual(
    applyDentalTreatmentCharge({ totalBill: 0, due: 0, advanceBalance: 3000 }, 3000),
    {
      newTotalBill: 3000,
      newDue: 0,
      newAdvanceBalance: 0,
      advanceApplied: 3000,
      paymentStatus: "Paid",
    }
  );
});

test("negative, fractional, and non-finite charges are rejected", () => {
  assert.throws(
    () => applyDentalTreatmentCharge({ totalBill: 0, due: 0, advanceBalance: 0 }, -1),
    /DENTAL_CHARGE_INVALID/
  );
  assert.throws(
    () => applyDentalTreatmentCharge({ totalBill: 0, due: 0, advanceBalance: 0 }, 10.5),
    /DENTAL_CHARGE_INVALID/
  );
  assert.throws(
    () => applyDentalTreatmentCharge({ totalBill: 0, due: 0, advanceBalance: 0 }, Number.NaN),
    /DENTAL_CHARGE_INVALID/
  );
});

test("Dental writer keeps treatment, patient billing, and audit in one Sheets mutation", () => {
  const dental = source("lib/webos/dentalClinical.ts");
  const transaction = source("lib/webos/sheetTransaction.ts");

  assert.match(dental, /appendEntityWithCellUpdatesAndAudit/);
  assert.match(dental, /\["05_Treatments", "02_Patients"\]/);
  assert.match(dental, /"Total_Bill"/);
  assert.match(dental, /"Advance_Balance"/);
  assert.match(dental, /"Payment_Status"/);
  assert.match(dental, /invalidatePatientsCache\(\)/);
  assert.match(transaction, /batchUpdateSpreadsheet\(workbook, requests\)/);

  assert.doesNotMatch(dental, /06_Payments/);
  assert.doesNotMatch(dental, /21_Cash_Movement/);
  assert.doesNotMatch(dental, /createPayment/);
});

test("Dental retry reuses one request ID and cannot double-charge", () => {
  const dental = source("lib/webos/dentalClinical.ts");
  const route = source("app/api/clinical/dental/route.ts");
  const client = source("components/DentalClinicalWorkspaceClient.tsx");

  assert.match(dental, /DENTALREQ:\$\{requestId\}/);
  assert.match(dental, /duplicate: true/);
  assert.match(route, /withMutationLock\(`patient:Dental:\$\{patientId\}`/);
  assert.match(route, /requestId: body\.requestId/);
  assert.match(client, /const requestIdRef = useRef\(""\)/);
  assert.match(client, /if \(!requestIdRef\.current\) requestIdRef\.current = nextRequestId\(\)/);
  assert.match(client, /requestId: requestIdRef\.current/);
  assert.match(client, /duplicate charge blocked/);
});
