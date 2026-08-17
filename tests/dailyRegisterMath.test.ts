import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { totalLatestPatientDue } from "../lib/domain/finance/dailyRegisterMath.ts";

test("repeat payments sum cash but Due summary keeps only latest patient snapshot", () => {
  const rows = [
    { receiptNo: "REC-1", patientId: "PT-1", patientName: "Patient A", due: 4000 },
    { receiptNo: "REC-2", patientId: "PT-1", patientName: "Patient A", due: 2000 },
    { receiptNo: "REC-3", patientId: "PT-2", patientName: "Patient B", due: 500 },
  ];
  assert.equal(totalLatestPatientDue(rows), 2500);
});

test("anonymous rows do not collapse unless they share a patient identity", () => {
  assert.equal(
    totalLatestPatientDue([
      { receiptNo: "REC-A", patientId: "", patientName: "", due: 100 },
      { receiptNo: "REC-B", patientId: "", patientName: "", due: 200 },
    ]),
    300
  );
});

test("name fallback merges repeated rows when Patient_ID is missing", () => {
  assert.equal(
    totalLatestPatientDue([
      { receiptNo: "REC-A", patientId: "", patientName: "Patient X", due: 900 },
      { receiptNo: "REC-B", patientId: "", patientName: " patient  x ", due: 400 },
    ]),
    400
  );
});

test("legacy Physio parity register uses latest-patient due aggregation", () => {
  const parity = readFileSync(new URL("../lib/webos/parity.ts", import.meta.url), "utf8");
  assert.match(parity, /totalLatestPatientDue\(result\)/);
  assert.doesNotMatch(parity, /totalDue: result\.reduce\(\(sum, row\) => sum \+ row\.due, 0\)/);
});
