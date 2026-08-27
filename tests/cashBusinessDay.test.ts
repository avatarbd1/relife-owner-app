import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASH_BUSINESS_DAY_START_HOUR,
  CASH_CUSTODY_LEDGER_START_DATE,
  cashBusinessDate,
  isCashCustodyLedgerDate,
} from "../lib/domain/finance/cashBusinessDay.ts";

test("cash business date rolls to previous calendar day before 09:00 Dhaka", () => {
  assert.equal(CASH_BUSINESS_DAY_START_HOUR, 9);
  assert.equal(
    cashBusinessDate(new Date("2026-08-16T22:55:00.000Z")),
    "2026-08-16"
  ); // Aug 17 04:55 Dhaka
  assert.equal(
    cashBusinessDate(new Date("2026-08-16T02:59:59.000Z")),
    "2026-08-15"
  ); // Aug 16 08:59 Dhaka
  assert.equal(
    cashBusinessDate(new Date("2026-08-16T03:00:00.000Z")),
    "2026-08-16"
  ); // Aug 16 09:00 Dhaka
});

test("cash custody carries across month rollover but excludes July legacy", () => {
  assert.equal(CASH_CUSTODY_LEDGER_START_DATE, "2026-08-01");
  assert.equal(isCashCustodyLedgerDate("2026-07-31", "2026-09-01"), false);
  assert.equal(isCashCustodyLedgerDate("2026-08-01", "2026-09-01"), true);
  assert.equal(isCashCustodyLedgerDate("2026-08-31", "2026-09-01"), true);
  assert.equal(isCashCustodyLedgerDate("2026-09-01", "2026-09-01"), true);
  assert.equal(isCashCustodyLedgerDate("2026-09-02", "2026-09-01"), false);
});

test("month boundary before 09:00 still belongs to previous business day", () => {
  assert.equal(
    cashBusinessDate(new Date("2026-08-31T02:59:59.000Z")),
    "2026-08-30"
  ); // Aug 31 08:59 Dhaka
  assert.equal(
    cashBusinessDate(new Date("2026-08-31T18:30:00.000Z")),
    "2026-08-31"
  ); // Sep 1 00:30 Dhaka
  assert.equal(
    cashBusinessDate(new Date("2026-09-01T03:00:00.000Z")),
    "2026-09-01"
  ); // Sep 1 09:00 Dhaka
});

test("cash integration stores business date but preserves real timestamps", () => {
  const scoped = readFileSync(new URL("../lib/scopedCash.ts", import.meta.url), "utf8");
  const cash = readFileSync(
    new URL("../lib/domain/finance/cash.ts", import.meta.url),
    "utf8"
  );

  assert.match(scoped, /isCashCustodyLedgerDate/);
  assert.match(scoped, /const asOfBusinessDate = cashBusinessDate\(now\)/);
  assert.doesNotMatch(scoped, /startsWith\(month\)/);
  assert.match(cash, /Date: businessDate/);
  assert.match(cash, /Requested_At: now\.timestamp/);
  assert.match(cash, /Timestamp: now\.timestamp/);
});
