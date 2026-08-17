import { execSync } from "node:child_process";

const body = process.env.PR_BODY ?? "";
const baseRef = process.env.BASE_REF || "main";

function changedFiles() {
  try {
    return execSync(`git diff --name-only origin/${baseRef}...HEAD`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (error) {
    console.error("Unable to calculate changed files for PR impact review.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const files = changedFiles();
const docsOnly = files.every(
  (file) =>
    file.startsWith("docs/") ||
    file.startsWith(".github/") ||
    file.startsWith("tests/") ||
    file === "scripts/validate-pr-impact.mjs"
);

const areas = [
  {
    name: "Patient / patient file / reports",
    patterns: [/patient/i, /report/i, /media/i, /storage/i],
  },
  {
    name: "Appointment / schedule / Chamber",
    patterns: [/appointment/i, /schedule/i, /chamber/i, /booking/i, /machine/i, /timeline/i],
  },
  {
    name: "Finance: payment / expense / cash / salary",
    patterns: [/finance/i, /payment/i, /expense/i, /cash/i, /salary/i, /ledger/i],
  },
  {
    name: "Clinical: assessment / treatment / dental / AI",
    patterns: [/clinical/i, /assessment/i, /treatment/i, /dental/i, /case.?study/i, /ai/i],
  },
  {
    name: "Role / authorization / authentication",
    patterns: [/auth/i, /role/i, /access/i, /permission/i, /session/i, /webauthn/i, /proxy\.ts$/i],
  },
  {
    name: "Google Sheets / data contract / cache",
    patterns: [/sheet/i, /cache/i, /data.?contract/i, /spreadsheet/i],
  },
  {
    name: "Supabase / Edge Function / database / storage",
    patterns: [/supabase/i, /migration/i, /edge/i, /database/i, /storage/i],
  },
  {
    name: "Notifications / chat / PWA",
    patterns: [/notification/i, /chat/i, /sw\.js$/i, /manifest/i, /pwa/i],
  },
  {
    name: "Reports / analytics / dashboard totals",
    patterns: [/report/i, /analytics/i, /dashboard/i, /daily/i, /register/i],
  },
  {
    name: "Inventory / staff / settings / admin",
    patterns: [/inventory/i, /staff/i, /settings/i, /admin/i, /equipment/i],
  },
];

const impacted = areas.filter(({ patterns }) =>
  files.some((file) => patterns.some((pattern) => pattern.test(file)))
);

function isChecked(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`- \\[x\\] ${escaped}`, "i").test(body);
}

const errors = [];

for (const heading of [
  "## Change summary",
  "## Impacted areas",
  "## Regression impact review",
  "## Automated verification",
  "## User-flow validation",
  "## Rollback",
]) {
  if (!body.includes(heading)) errors.push(`Missing required PR section: ${heading}`);
}

for (const area of impacted) {
  if (!isChecked(area.name)) {
    errors.push(`Changed files indicate impact on '${area.name}', but that area is not checked in the PR body.`);
  }
}

if (docsOnly) {
  if (!/User-flow tested:\s*N\/A \(docs\/tests only\)/i.test(body)) {
    errors.push("Docs/tests-only PR must explicitly use 'User-flow tested: N/A (docs/tests only)'.");
  }
} else {
  if (!/User-flow tested:\s*YES/i.test(body)) {
    errors.push("Runtime PR requires 'User-flow tested: YES' before merge.");
  }
  if (/Roles tested:\s*<|Roles tested:\s*$/im.test(body)) {
    errors.push("Runtime PR must name the role(s) used for user-flow testing.");
  }
  if (/Evidence:\s*<|Evidence:\s*$/im.test(body)) {
    errors.push("Runtime PR must include user-flow evidence.");
  }
  if (/Rollback procedure:\s*<|Rollback procedure:\s*$/im.test(body)) {
    errors.push("Runtime PR must include an exact rollback procedure.");
  }
}

console.log("Changed files:");
for (const file of files) console.log(`- ${file}`);
console.log(`\nPR type: ${docsOnly ? "docs/tests/process only" : "runtime"}`);
console.log("Predicted impacted areas:");
if (impacted.length === 0) console.log("- No domain inferred from file paths; manual impact review still required.");
for (const area of impacted) console.log(`- ${area.name}`);

if (errors.length) {
  console.error("\nPR impact/user-flow gate failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("\nPR impact/user-flow gate passed.");
