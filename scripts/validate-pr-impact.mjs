import { execFileSync } from "node:child_process";

const body = process.env.PR_BODY ?? "";
const baseRef = process.env.BASE_REF || "main";
const baseSha = process.env.BASE_SHA?.trim() ?? "";
const isDraft = /^true$/i.test(process.env.PR_DRAFT ?? "false");

const AREA_LABELS = [
  "Patient / patient file / reports",
  "Appointment / schedule / Chamber",
  "Finance: payment / expense / cash / salary",
  "Clinical: assessment / treatment / dental / AI",
  "Role / authorization / authentication",
  "Google Sheets / data contract / cache",
  "Supabase / Edge Function / database / storage",
  "Notifications / chat / PWA",
  "Reports / analytics / dashboard totals",
  "Inventory / staff / settings / admin",
];
const PROCESS_LABEL = "No runtime impact (docs/tests/process only)";
const HIGH_RISK_AREAS = new Set([
  "Finance: payment / expense / cash / salary",
  "Role / authorization / authentication",
  "Google Sheets / data contract / cache",
  "Supabase / Edge Function / database / storage",
]);

function gitLines(command, args, failureMessage) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (error) {
    console.error(failureMessage);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (baseSha && !/^[0-9a-f]{40}$/i.test(baseSha)) {
  console.error("Unable to calculate changed files for PR review.");
  console.error("BASE_SHA must be a 40-character commit SHA.");
  process.exit(1);
}

if (!baseSha && !/^[A-Za-z0-9._/-]+$/.test(baseRef)) {
  console.error("Unable to calculate changed files for PR review.");
  console.error("BASE_REF contains unsupported characters.");
  process.exit(1);
}

// Pull-request event payloads provide an immutable base SHA. Prefer it over
// origin/<base>, which can advance while a ready-for-review job is running.
const diffBase = baseSha || `origin/${baseRef}`;
const files = gitLines(
  "git",
  ["diff", "--name-only", `${diffBase}...HEAD`],
  "Unable to calculate changed files for PR review."
);

const docsOnly = files.every(
  (file) =>
    file.startsWith("docs/") ||
    file.startsWith(".github/") ||
    file.startsWith("tests/") ||
    file.startsWith("scripts/") ||
    file === "AGENTS.md" ||
    file === "CLAUDE.md" ||
    file === "MIGRATION_AUDIT.md"
);

function isChecked(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- \\[x\\] ${escaped}$`, "im").test(body);
}

function field(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`^${escaped}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
}

export function isPlaceholder(value) {
  const clean = String(value ?? "")
    .replaceAll("`", "")
    .trim();
  return (
    !clean ||
    /^<.*>$/.test(clean) ||
    /^(todo|tbd|n\/?a|n\.a\.?|not yet tested|draft verification pending)$/i.test(clean) ||
    /command plus relevant result|route\/domain\/writer|exact WebAction/i.test(clean)
  );
}

const errors = [];
for (const heading of [
  "## Change summary",
  "## Impacted areas",
  "## Automated verification",
  "## User-flow validation",
  "## Rollback",
]) {
  if (!body.includes(heading)) errors.push(`Missing required PR section: ${heading}`);
}

const checkedAreas = AREA_LABELS.filter(isChecked);
const processChecked = isChecked(PROCESS_LABEL);

if (docsOnly) {
  if (!processChecked) errors.push(`Process-only PR must check '${PROCESS_LABEL}'.`);
  if (!/User-flow tested:\s*N\/A \(docs\/tests only\)/i.test(body)) {
    errors.push("Process-only PR must use 'User-flow tested: N/A (docs/tests only)'.");
  }
} else {
  if (processChecked) errors.push(`Runtime PR must not check '${PROCESS_LABEL}'.`);
  if (checkedAreas.length === 0) errors.push("Runtime PR must check at least one impacted area.");
  if (!body.includes("## Canonical-path review")) {
    errors.push("Runtime PR is missing '## Canonical-path review'.");
  }

  const riskTier = field("Risk tier").toUpperCase();
  if (!new Set(["STANDARD", "HIGH"]).has(riskTier)) {
    errors.push("Runtime PR requires 'Risk tier: STANDARD' or 'Risk tier: HIGH'.");
  }
  if (checkedAreas.some((area) => HIGH_RISK_AREAS.has(area)) && riskTier !== "HIGH") {
    errors.push("Finance, auth, data-contract, and database changes require 'Risk tier: HIGH'.");
  }

  for (const label of [
    "Existing-path search",
    "Canonical path reused",
    "Permission reused",
    "Dual-writer impact",
  ]) {
    if (isPlaceholder(field(label))) errors.push(`Runtime PR requires concrete '${label}' evidence.`);
  }

  const authorityChange = field("Authority or writer changed").toUpperCase();
  if (!new Set(["YES", "NO"]).has(authorityChange)) {
    errors.push("Runtime PR must declare 'Authority or writer changed: YES' or 'NO'.");
  }
  if (authorityChange === "YES" && !/^#\d+$/.test(field("Owner-approved issue"))) {
    errors.push("Authority/writer changes require an Owner-approved issue in #123 form.");
  }

  const userFlow = field("User-flow tested").toUpperCase();
  if (isDraft) {
    if (!new Set(["YES", "DEFERRED (DRAFT)"]).has(userFlow)) {
      errors.push("Draft runtime PR requires user flow YES or DEFERRED (Draft).");
    }
  } else if (userFlow !== "YES") {
    errors.push("Ready runtime PR requires 'User-flow tested: YES'.");
  }

  if (userFlow === "YES") {
    for (const label of ["Roles tested", "Device/context", "Scenario", "Actual result", "Evidence"]) {
      if (isPlaceholder(field(label))) errors.push(`Completed user flow requires concrete '${label}'.`);
    }
  }
}

for (const label of ["Rollback procedure", "Data rollback needed"]) {
  if (isPlaceholder(field(label))) errors.push(`PR requires concrete '${label}'.`);
}

console.log("Changed files:");
for (const file of files) console.log(`- ${file}`);
console.log(`\nPR type: ${docsOnly ? "docs/tests/process only" : "runtime"}`);
console.log(`PR state: ${isDraft ? "draft" : "ready"}`);
console.log("Declared impacted areas:");
for (const area of checkedAreas) console.log(`- ${area}`);
if (processChecked) console.log(`- ${PROCESS_LABEL}`);

if (errors.length) {
  console.error("\nPR impact/user-flow gate failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("\nPR impact/user-flow gate passed.");
