import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionRoots = ["app/api", "lib/domain", "lib/webos"];

// Historical implementations retained in-tree but superseded by canonical domain/runtime paths.
// They may keep migration-era literals only while they remain unreachable from app/ and lib/domain/.
const legacyResidueModules = new Map([
  ["lib/webos/appointmentScheduling.ts", "@/lib/webos/appointmentScheduling"],
  ["lib/webos/cashAcceptance.ts", "@/lib/webos/cashAcceptance"],
  ["lib/webos/chamberFixedHour.ts", "@/lib/webos/chamberFixedHour"],
  ["lib/webos/financeOps.ts", "@/lib/webos/financeOps"],
  ["lib/webos/machineRuntime.ts", "@/lib/webos/machineRuntime"],
]);

function sourceFiles(root: string): string[] {
  const absoluteRoot = join(repoRoot, root);
  const out: string[] = [];

  function walk(path: string): void {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const stat = statSync(child);
      if (stat.isDirectory()) {
        walk(child);
      } else if (/\.(?:ts|tsx)$/.test(entry)) {
        out.push(child);
      }
    }
  }

  walk(absoluteRoot);
  return out;
}

function sources(roots: string[]): Array<{ path: string; content: string }> {
  return roots.flatMap((root) =>
    sourceFiles(root).map((path) => ({
      path: relative(repoRoot, path).replaceAll("\\", "/"),
      content: readFileSync(path, "utf8"),
    }))
  );
}

function productionSources(): Array<{ path: string; content: string }> {
  return sources(productionRoots);
}

test("T3 closure: legacy tenant-literal modules are unreachable from canonical production entrypoints", () => {
  const canonical = sources(["app", "lib/domain"]);
  const violations: string[] = [];

  for (const [legacyPath, importPath] of legacyResidueModules) {
    for (const file of canonical) {
      if (file.path === legacyPath) continue;
      if (file.content.includes(importPath)) {
        violations.push(`${file.path} imports ${legacyPath}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Legacy tenant-literal module is still reachable from a canonical production path:\n${violations.join("\n")}`
  );
});

test("T3 closure: canonical production code has no hardcoded tenant identity literals", () => {
  const forbidden = ["RELIFE-PHYSIO", "RELIFE-DENTAL", '"RELIFE"', "'RELIFE'"];
  const violations: string[] = [];

  for (const file of productionSources()) {
    if (legacyResidueModules.has(file.path)) continue;
    for (const literal of forbidden) {
      if (file.content.includes(literal)) {
        violations.push(`${file.path}: ${literal}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Hardcoded tenant identity found in canonical production code:\n${violations.join("\n")}`
  );
});

test("T3 closure: tenant-scoped API routes do not use legacy access-only context", () => {
  const accessOnlyExceptions = new Set([
    // Changes only the signed user's UI department scope cookie; it reads/writes no tenant data.
    "app/api/scope/route.ts",
  ]);
  const violations = sourceFiles("app/api")
    .map((path) => ({
      path: relative(repoRoot, path).replaceAll("\\", "/"),
      content: readFileSync(path, "utf8"),
    }))
    .filter(
      (file) =>
        !accessOnlyExceptions.has(file.path) &&
        file.content.includes("requireCurrentAccessContext")
    )
    .map((file) => file.path);

  assert.deepEqual(
    violations,
    [],
    `Legacy requireCurrentAccessContext found in tenant-scoped production API routes:\n${violations.join("\n")}`
  );
});
