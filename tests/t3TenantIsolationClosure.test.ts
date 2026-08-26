import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// T3 closure guard: scan tenant-sensitive production boundaries, not fixtures/config docs.
const productionRoots = ["app/api", "lib/domain", "lib/webos"];

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

function productionSources(): Array<{ path: string; content: string }> {
  return productionRoots.flatMap((root) =>
    sourceFiles(root).map((path) => ({
      path: relative(repoRoot, path).replaceAll("\\", "/"),
      content: readFileSync(path, "utf8"),
    }))
  );
}

test("T3 closure: production code has no hardcoded tenant identity literals", () => {
  const forbidden = ["RELIFE-PHYSIO", "RELIFE-DENTAL", '"RELIFE"', "'RELIFE'"];
  const violations: string[] = [];

  for (const file of productionSources()) {
    for (const literal of forbidden) {
      if (file.content.includes(literal)) {
        violations.push(`${file.path}: ${literal}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Hardcoded tenant identity found in production code:\n${violations.join("\n")}`
  );
});

test("T3 closure: production API routes do not use legacy access-only context", () => {
  const violations = sourceFiles("app/api")
    .map((path) => ({
      path: relative(repoRoot, path).replaceAll("\\", "/"),
      content: readFileSync(path, "utf8"),
    }))
    .filter((file) => file.content.includes("requireCurrentAccessContext"))
    .map((file) => file.path);

  assert.deepEqual(
    violations,
    [],
    `Legacy requireCurrentAccessContext found in production API routes:\n${violations.join("\n")}`
  );
});
