import test from "node:test";
import assert from "node:assert/strict";
import { escapeCsv, objectsToCsv, parseCsv } from "../lib/csv";

test("parseCsv handles quoted commas, escaped quotes and newlines", () => {
  const rows = parseCsv('name,address,note\r\n"Rahim, Jr.","Road 1, Amtali","Line 1\nLine 2"\r\n"A ""Quoted"" Name",Bar,Baz');
  assert.deepEqual(rows, [
    ["name", "address", "note"],
    ["Rahim, Jr.", "Road 1, Amtali", "Line 1\nLine 2"],
    ['A "Quoted" Name', "Bar", "Baz"],
  ]);
});

test("parseCsv rejects an unclosed quoted field", () => {
  assert.throws(() => parseCsv('name,note\nRahim,"broken'), /CSV_UNCLOSED_QUOTE/);
});

test("escapeCsv protects spreadsheet formulas without corrupting numeric negatives", () => {
  assert.equal(escapeCsv("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(escapeCsv("+SUM(1,2)"), '"\'+SUM(1,2)"');
  assert.equal(escapeCsv("@cmd"), "'@cmd");
  assert.equal(escapeCsv("-not-a-number"), "'-not-a-number");
  assert.equal(escapeCsv(-125.5), "-125.5");
});

test("objectsToCsv emits stable headers and CRLF rows", () => {
  const csv = objectsToCsv([{ name: "A,B", amount: 10 }], ["name", "amount"]);
  assert.equal(csv, 'name,amount\r\n"A,B",10');
});
