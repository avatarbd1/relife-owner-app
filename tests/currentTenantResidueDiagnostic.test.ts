import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path);
  return readdirSync(absolute).flatMap((entry) => {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) return filesUnder(relative(ROOT, full));
    return /\.(?:ts|tsx)$/.test(full) ? [full] : [];
  });
}

test("shared legacy patient reader is reachable only through the tenant-aware reception boundary", () => {
  const importers = filesUnder("app")
    .concat(filesUnder("lib"))
    .map((file) => ({
      path: relative(ROOT, file).replaceAll("\\", "/"),
      content: readFileSync(file, "utf8"),
    }))
    .filter(
      (file) =>
        file.path !== "lib/patients.ts" &&
        (file.content.includes('from "@/lib/patients"') ||
          file.content.includes("from '@/lib/patients'"))
    )
    .map((file) => file.path)
    .sort();

  assert.deepEqual(
    importers,
    ["lib/webos/reception.ts"],
    `Direct legacy patient-reader import bypasses the tenant-aware reception boundary:\n${importers.join("\n")}`
  );
});

test("legacy patient loader cannot pretend to be generic tenant routing", () => {
  const source = readFileSync(join(ROOT, "lib/patients.ts"), "utf8");
  assert.match(source, /fetchSheetRanges\("physio"/);
  assert.match(source, /fetchSheetRanges\("dental"/);
  assert.match(source, /"RELIFE-PHYSIO"/);
  assert.match(source, /"RELIFE-DENTAL"/);
});
