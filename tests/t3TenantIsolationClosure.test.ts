import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const productionRoots = ["app/api", "lib/domain", "lib/webos"];

// Truly superseded implementation: it may retain migration-era ledger literals
// only while canonical production code cannot import it.
const unreachableLegacyModules = new Map([
  ["lib/webos/chamberFixedHour.ts", "@/lib/webos/chamberFixedHour"],
]);

// These modules are still active compatibility boundaries for the legacy Google
// Sheets ledger. Their RELIFE-* values are ledger identities, not Supabase tenant
// primary keys. Keep their reachability explicitly bounded so the exception
// cannot silently spread to new production entrypoints.
const boundedLedgerCompatibility = new Map<string, { importPath: string; allowedImporters: Set<string> }>([
  [
    "lib/webos/appointmentScheduling.ts",
    {
      importPath: "@/lib/webos/appointmentScheduling",
      allowedImporters: new Set([
        "app/(dashboard)/appointments/new/page.tsx",
        "lib/domain/appointments/create.ts",
        "lib/domain/appointments/therapistCapacity.ts",
      ]),
    },
  ],
  [
    "lib/webos/cashAcceptance.ts",
    {
      importPath: "@/lib/webos/cashAcceptance",
      allowedImporters: new Set([
        "app/(dashboard)/finance/cash-receive/page.tsx",
        "app/api/finance/cash/accept/route.ts",
      ]),
    },
  ],
  [
    "lib/webos/financeOps.ts",
    {
      importPath: "@/lib/webos/financeOps",
      allowedImporters: new Set([
        "app/(dashboard)/finance/operations/page.tsx",
        "app/(dashboard)/payments/page.tsx",
      ]),
    },
  ],
  [
    "lib/webos/machineRuntime.ts",
    {
      importPath: "@/lib/webos/machineRuntime",
      allowedImporters: new Set([
        "app/api/chamber/machines/route.ts",
        "app/api/chamber/route.ts",
      ]),
    },
  ],
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

test("T3 closure: superseded tenant-literal modules are unreachable from canonical production entrypoints", () => {
  const canonical = sources(["app", "lib/domain"]);
  const violations: string[] = [];

  for (const [legacyPath, importPath] of unreachableLegacyModules) {
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
    `Superseded tenant-literal module is still reachable from a canonical production path:\n${violations.join("\n")}`
  );
});

test("T3 closure: legacy ledger compatibility imports remain on the reviewed bounded paths", () => {
  const canonical = sources(["app", "lib/domain"]);
  const violations: string[] = [];

  for (const [legacyPath, config] of boundedLedgerCompatibility) {
    const actual = canonical
      .filter((file) => file.path !== legacyPath && file.content.includes(config.importPath))
      .map((file) => file.path)
      .sort();
    const expected = [...config.allowedImporters].sort();
    if (!actual.every((path) => config.allowedImporters.has(path))) {
      violations.push(`${legacyPath} has unreviewed importer(s): ${actual.filter((path) => !config.allowedImporters.has(path)).join(", ")}`);
    }
    if (!expected.every((path) => actual.includes(path))) {
      violations.push(`${legacyPath} reviewed importer set changed; expected ${expected.join(", ")}, actual ${actual.join(", ")}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Legacy ledger compatibility boundary changed without review:\n${violations.join("\n")}`
  );
});

test("T3 closure: canonical production code has no hardcoded tenant identity literals outside reviewed ledger compatibility", () => {
  const forbidden = ["RELIFE-PHYSIO", "RELIFE-DENTAL", '"RELIFE"', "'RELIFE'"];
  const violations: string[] = [];

  for (const file of productionSources()) {
    if (unreachableLegacyModules.has(file.path) || boundedLedgerCompatibility.has(file.path)) continue;
    for (const literal of forbidden) {
      if (file.content.includes(literal)) {
        violations.push(`${file.path}: ${literal}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Hardcoded tenant identity found outside the reviewed ledger compatibility boundary:\n${violations.join("\n")}`
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
