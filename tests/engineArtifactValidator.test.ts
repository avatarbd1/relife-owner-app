import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateHandoff } from "../scripts/validate-claude-artifact.mjs";

const BASE_SHA = "a".repeat(40);
const PATCH = [
  "diff --git a/docs/example.md b/docs/example.md",
  "new file mode 100644",
  "index 0000000..ce01362",
  "--- /dev/null",
  "+++ b/docs/example.md",
  "@@ -0,0 +1 @@",
  "+hello",
  "",
].join("\n");

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "relife-handoff-test-"));
  await mkdir(path.join(root, "evidence"));
  await writeFile(path.join(root, "changes.patch"), PATCH);
  await writeFile(path.join(root, "REVIEW.md"), "Reviewed scope and invariants.\n");
  await writeFile(path.join(root, "evidence/tests.txt"), "tests pass\n");
  await writeFile(path.join(root, "evidence/lint.txt"), "lint pass\n");
  await writeFile(path.join(root, "evidence/build.txt"), "build pass\n");

  const manifest = {
    version: 1,
    repository: "avatarbd1/relife-owner-app",
    baseSha: BASE_SHA,
    taskId: "engine-validator-test",
    riskTier: "standard",
    status: "complete",
    changedFiles: ["docs/example.md"],
    patchSha256: createHash("sha256").update(PATCH).digest("hex"),
    authorityChanged: false,
    newCanonicalWriter: false,
    ownerIssue: null,
    actions: {
      commit: false,
      push: false,
      pullRequest: false,
      merge: false,
      deploy: false,
      productionMutation: false,
    },
    verification: [
      { command: "npm test", exitCode: 0, evidence: "evidence/tests.txt" },
      { command: "npm run lint", exitCode: 0, evidence: "evidence/lint.txt" },
      { command: "npm run build", exitCode: 0, evidence: "evidence/build.txt" },
    ],
    ...overrides,
  };
  await writeFile(path.join(root, "HANDOFF.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

test("accepts a complete artifact matching the immutable base", async () => {
  const root = await fixture();
  const result = await validateHandoff(root, BASE_SHA);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.changedFiles, ["docs/example.md"]);
});

test("rejects a stale artifact base", async () => {
  const root = await fixture();
  const result = await validateHandoff(root, "b".repeat(40));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /does not match expected base/);
});

test("rejects GitHub or production actions claimed by Claude", async () => {
  const root = await fixture({
    actions: {
      commit: false,
      push: true,
      pullRequest: false,
      merge: false,
      deploy: false,
      productionMutation: false,
    },
  });
  const result = await validateHandoff(root, BASE_SHA);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /actions\.push must be false/);
});

test("rejects a manifest that does not match the patch", async () => {
  const root = await fixture({ changedFiles: ["docs/other.md"] });
  const result = await validateHandoff(root, BASE_SHA);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /changedFiles does not match/);
});

test("requires an Owner issue for a new canonical writer", async () => {
  const root = await fixture({
    riskTier: "high",
    newCanonicalWriter: true,
    ownerIssue: null,
  });
  const result = await validateHandoff(root, BASE_SHA);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /require ownerIssue/);
});

test("accepts a truthful blocked artifact without a patch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "relife-blocked-test-"));
  await writeFile(path.join(root, "BLOCKED.md"), "Required writer authority is unknown.\n");
  await writeFile(
    path.join(root, "HANDOFF.json"),
    `${JSON.stringify(
      {
        version: 1,
        repository: "avatarbd1/relife-owner-app",
        baseSha: BASE_SHA,
        taskId: "blocked-authority",
        riskTier: "high",
        status: "blocked",
        authorityChanged: false,
        newCanonicalWriter: false,
        ownerIssue: null,
        actions: {
          commit: false,
          push: false,
          pullRequest: false,
          merge: false,
          deploy: false,
          productionMutation: false,
        },
      },
      null,
      2
    )}\n`
  );
  const result = await validateHandoff(root, BASE_SHA);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.changedFiles, []);
});
