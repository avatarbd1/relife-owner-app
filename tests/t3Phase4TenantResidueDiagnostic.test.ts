import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = ["app/api", "lib/domain", "lib/webos"];
const BANNED = [/"RELIFE"/, /"RELIFE-PHYSIO"/, /"RELIFE-DENTAL"/, /`RELIFE:/, /`RELIFE-PHYSIO:/, /`RELIFE-DENTAL:/];

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path);
  return readdirSync(absolute).flatMap((entry) => {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) return filesUnder(relative(ROOT, full));
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

test("diagnostic: list production hardcoded tenant literals", () => {
  const matches: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of filesUnder(root)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (BANNED.some((pattern) => pattern.test(line))) {
          matches.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(matches, [], `Hardcoded tenant residue:\n${matches.join("\n")}`);
});
