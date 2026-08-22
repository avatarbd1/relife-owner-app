import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "avatarbd1/relife-owner-app";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_TASK_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const ACTION_NAMES = [
  "commit",
  "push",
  "pullRequest",
  "merge",
  "deploy",
  "productionMutation",
];

function safeRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\")) return false;
  if (path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== ".." && !normalized.startsWith("../");
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function patchFiles(source) {
  const files = [];
  for (const line of source.split("\n")) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match) continue;
    const destination = match[2];
    if (!safeRelativePath(destination)) {
      throw new Error(`Unsafe path in changes.patch: ${destination}`);
    }
    files.push(destination);
  }
  return sortedUnique(files);
}

async function assertRegularFile(root, relativePath, errors) {
  if (!safeRelativePath(relativePath)) {
    errors.push(`Unsafe artifact path: ${relativePath}`);
    return null;
  }
  try {
    const absolutePath = path.join(root, relativePath);
    const stat = await lstat(absolutePath);
    if (!stat.isFile()) {
      errors.push(`${relativePath} must be a regular file.`);
      return null;
    }
    return absolutePath;
  } catch {
    errors.push(`Missing required file: ${relativePath}`);
    return null;
  }
}

async function rejectLinks(root, current, errors) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath);
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      errors.push(`Symlinks are not allowed: ${relativePath}`);
    } else if (stat.isDirectory()) {
      await rejectLinks(root, absolutePath, errors);
    }
  }
}

export async function validateHandoff(rootDirectory, expectedBaseSha) {
  const root = path.resolve(rootDirectory);
  const errors = [];

  try {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory()) return { ok: false, errors: ["Artifact root must be a directory."] };
    await rejectLinks(root, root, errors);
  } catch {
    return { ok: false, errors: ["Artifact directory does not exist."] };
  }

  const manifestPath = await assertRegularFile(root, "HANDOFF.json", errors);
  if (!manifestPath) return { ok: false, errors };

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    errors.push("HANDOFF.json must contain valid JSON.");
    return { ok: false, errors };
  }

  if (manifest.version !== 1) errors.push("HANDOFF.json version must be 1.");
  if (manifest.repository !== REPOSITORY) errors.push(`repository must be ${REPOSITORY}.`);
  if (!SHA_PATTERN.test(manifest.baseSha ?? "")) errors.push("baseSha must be a 40-character commit SHA.");
  if (expectedBaseSha && manifest.baseSha !== expectedBaseSha) {
    errors.push(`Artifact base ${manifest.baseSha} does not match expected base ${expectedBaseSha}.`);
  }
  if (!SAFE_TASK_PATTERN.test(manifest.taskId ?? "")) errors.push("taskId is missing or unsafe.");
  if (!new Set(["standard", "high"]).has(manifest.riskTier)) {
    errors.push("riskTier must be standard or high.");
  }
  if (!new Set(["complete", "blocked"]).has(manifest.status)) {
    errors.push("status must be complete or blocked.");
  }

  for (const action of ACTION_NAMES) {
    if (manifest.actions?.[action] !== false) {
      errors.push(`actions.${action} must be false.`);
    }
  }

  if (typeof manifest.authorityChanged !== "boolean") errors.push("authorityChanged must be boolean.");
  if (typeof manifest.newCanonicalWriter !== "boolean") {
    errors.push("newCanonicalWriter must be boolean.");
  }
  if ((manifest.authorityChanged || manifest.newCanonicalWriter) && !/^#\d+$/.test(manifest.ownerIssue ?? "")) {
    errors.push("Authority changes or new writers require ownerIssue in #123 form.");
  }

  if (manifest.status === "blocked") {
    await assertRegularFile(root, "BLOCKED.md", errors);
    try {
      const patchPath = path.join(root, "changes.patch");
      const patchStat = await lstat(patchPath);
      if (patchStat.size > 0) errors.push("Blocked artifacts must not include a non-empty patch.");
    } catch {
      // A blocked artifact may omit changes.patch.
    }
    return { ok: errors.length === 0, errors, manifest, changedFiles: [] };
  }

  const patchPath = await assertRegularFile(root, "changes.patch", errors);
  await assertRegularFile(root, "REVIEW.md", errors);
  for (const evidenceFile of ["evidence/tests.txt", "evidence/lint.txt", "evidence/build.txt"]) {
    await assertRegularFile(root, evidenceFile, errors);
  }

  const changedFiles = Array.isArray(manifest.changedFiles) ? manifest.changedFiles : [];
  if (changedFiles.length === 0) errors.push("Complete artifacts require changedFiles.");
  if (changedFiles.some((file) => !safeRelativePath(file))) errors.push("changedFiles contains an unsafe path.");
  if (sortedUnique(changedFiles).length !== changedFiles.length) {
    errors.push("changedFiles must be unique and sorted.");
  }

  if (!Array.isArray(manifest.verification) || manifest.verification.length === 0) {
    errors.push("Complete artifacts require verification evidence.");
  } else {
    for (const item of manifest.verification) {
      if (typeof item?.command !== "string" || !item.command.trim()) {
        errors.push("Each verification item requires a command.");
      }
      if (!Number.isInteger(item?.exitCode)) errors.push("Each verification item requires an integer exitCode.");
      const evidence = item?.evidence;
      if (!safeRelativePath(evidence)) {
        errors.push("Each verification item requires a safe evidence path.");
      } else {
        await assertRegularFile(root, evidence, errors);
      }
    }
  }

  if (patchPath) {
    const patch = await readFile(patchPath);
    if (patch.length === 0) errors.push("Complete artifacts require a non-empty changes.patch.");
    const digest = createHash("sha256").update(patch).digest("hex");
    if (!SHA256_PATTERN.test(manifest.patchSha256 ?? "") || digest !== manifest.patchSha256) {
      errors.push("patchSha256 does not match changes.patch.");
    }
    try {
      const actualFiles = patchFiles(patch.toString("utf8"));
      if (JSON.stringify(actualFiles) !== JSON.stringify(changedFiles)) {
        errors.push("changedFiles does not match paths declared by changes.patch.");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { ok: errors.length === 0, errors, manifest, changedFiles };
}

async function main() {
  const args = process.argv.slice(2);
  const root = args[0];
  const baseIndex = args.indexOf("--base-sha");
  const expectedBaseSha = baseIndex >= 0 ? args[baseIndex + 1] : undefined;

  if (!root || (expectedBaseSha && !SHA_PATTERN.test(expectedBaseSha))) {
    console.error("Usage: node scripts/validate-claude-artifact.mjs DIR [--base-sha 40_CHAR_SHA]");
    process.exit(2);
  }

  const result = await validateHandoff(root, expectedBaseSha);
  if (!result.ok) {
    console.error("Claude artifact validation failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Claude artifact valid: ${result.manifest.taskId} (${result.manifest.status})`);
  for (const file of result.changedFiles) console.log(`- ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
