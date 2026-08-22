import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = join(dirname(fileURLToPath(import.meta.url)), "../scripts/validate-pr-impact.mjs");

const runtimeBody = `## Change summary

Adds a runtime route.

## Impacted areas

- [x] Inventory / staff / settings / admin
- [ ] No runtime impact (docs/tests/process only)

## Canonical-path review

Risk tier: STANDARD
Existing-path search: searched the existing route
Canonical path reused: existing route and writer
Permission reused: existing permission
Authority or writer changed: NO
Dual-writer impact: none

## Automated verification

- Tests pass.

## User-flow validation

User-flow tested: YES
Roles tested: Owner
Device/context: Android browser
Scenario: Open the runtime route
Actual result: Route opened successfully
Evidence: recorded smoke result

## Rollback

Rollback procedure: Revert the commit.
Data rollback needed: No.
`;

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRaceRepository() {
  const cwd = mkdtempSync(join(tmpdir(), "relife-pr-impact-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.name", "Relife CI Test");
  git(cwd, "config", "user.email", "ci-test@example.invalid");
  writeFileSync(join(cwd, "README.md"), "base\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-qm", "base");
  const baseSha = git(cwd, "rev-parse", "HEAD");

  mkdirSync(join(cwd, "app"));
  writeFileSync(join(cwd, "app/page.tsx"), "export default function Page() { return null; }\n");
  git(cwd, "add", "app/page.tsx");
  git(cwd, "commit", "-qm", "runtime change");

  // Simulate main advancing to contain the PR while a ready-for-review job is running.
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  return { cwd, baseSha };
}

test("PR impact gate uses immutable BASE_SHA when origin/main has already advanced", () => {
  const { cwd, baseSha } = createRaceRepository();
  try {
    const result = spawnSync(process.execPath, [validator], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PR_BODY: runtimeBody,
        PR_DRAFT: "false",
        BASE_REF: "main",
        BASE_SHA: baseSha,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /- app\/page\.tsx/);
    assert.match(result.stdout, /PR type: runtime/);
    assert.match(result.stdout, /PR impact\/user-flow gate passed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("PR impact gate rejects a malformed BASE_SHA", () => {
  const { cwd } = createRaceRepository();
  try {
    const result = spawnSync(process.execPath, [validator], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PR_BODY: runtimeBody,
        PR_DRAFT: "false",
        BASE_REF: "main",
        BASE_SHA: "not-a-commit",
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /BASE_SHA must be a 40-character commit SHA/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
