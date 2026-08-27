import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Phase A — named compatibility boundary for fixed Relife identifiers.
 *
 * `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md` section 27 permits existing Relife
 * compatibility code to remain during migration only where the boundary is
 * explicit, named, auditable, has a removal path, and cannot introduce new
 * Relife-specific defaults into commercial tenant paths.
 *
 * This test is that boundary. The ledger below is the complete, reviewed
 * inventory of files that still carry a fixed `RELIFE`, `RELIFE-PHYSIO`,
 * `RELIFE-DENTAL` or `amtali-main` identifier, with the count each file holds.
 *
 * The counts are ratchets:
 *
 * * A new file carrying a fixed identifier fails the test. That is the rule
 *   against introducing new Relife defaults.
 * * An increased count in a listed file fails the test. Compatibility debt may
 *   shrink, never grow.
 * * A decreased count fails the test too, asking the author to update the
 *   ledger. That keeps the removal path visible instead of letting the debt
 *   quietly drift.
 *
 * Removal path: each entry leaves this ledger when its call sites take
 * `organization_id` and `clinic_id` from the resolved tenant context. Phase B
 * (configuration core) and Phase C (facility/booking) own most of them; the
 * Sheets ledger identities in `lib/config/relifeSystem.ts` leave last, with the
 * Sheets compatibility boundary itself.
 */

/**
 * Two forms of the same defect.
 *
 * The first is a fixed identifier written as a literal at the call site. The
 * second is the same identity reached through a constant: `RELIFE_SYSTEM` and
 * `RELIFE_SUPABASE_SCOPE` resolve to `RELIFE` / `AMTALI-01` and
 * `relife` / `amtali-main`, so a reader that reaches for their tenant fields is
 * injecting a fixed clinic just as surely as one that types the string.
 *
 * A ledger that watched only literals would report shrinking debt every time an
 * injection was moved behind a constant, which is the opposite of progress.
 * Environment variable names such as `RELIFE_MUTATION_LOCK_SECRET` are excluded
 * deliberately: those are product branding on a secret, not tenant identity.
 */
const FIXED_IDENTIFIER =
  /"RELIFE(-PHYSIO|-DENTAL)?"|"amtali-main"|'amtali-main'|RELIFE_SUPABASE_SCOPE\.(organizationSlug|clinicSlug)|RELIFE_SYSTEM\.(organizationId|branchId)/g;

/** file -> number of fixed-identifier occurrences currently accepted. */
const COMPATIBILITY_LEDGER: ReadonlyMap<string, number> = new Map([
  // Named Sheets ledger identity module. Leaves last, with the Sheets boundary.
  ["lib/config/relifeSystem.ts", 4],

  // Sheets readers/writers that still hardcode the ledger tenant. Phase B.
  ["lib/data/index.ts", 24],
  ["lib/data/legacyReportStorage.ts", 2],
  ["lib/patients.ts", 4],
  ["lib/scopedCash.ts", 9],
  ["lib/webos/cashAcceptance.ts", 2],
  ["lib/webos/financeOps.ts", 13],
  ["lib/webos/reception.ts", 4],

  // Booking and runtime paths that still assume the Relife tenant. Phase C.
  ["lib/webos/appointmentScheduling.ts", 10],
  ["lib/webos/chamberFixedHour.ts", 10],
  ["lib/webos/machineRuntime.ts", 2],

  // Edge functions holding a default tenant slug for their bootstrap path.
  ["supabase/functions/relife-appointment-api/index.ts", 1],
  ["supabase/functions/relife-chamber-api/index.ts", 1],
  ["supabase/functions/relife-chamber-runtime-api/index.ts", 1],
  ["supabase/functions/relife-gamification-api/index.ts", 1],
  ["supabase/functions/relife-report-storage/index.ts", 2],
  ["supabase/functions/relife-reward-claims-api/index.ts", 1],
  ["supabase/functions/relife-weekly-gamification-finalizer/index.ts", 1],

  // Supabase readers reaching the fixed tenant through RELIFE_SUPABASE_SCOPE.
  // These resolve the same relife/amtali-main identity as a literal would.
  // Phase B, with the tenant-context cutover.
  ["lib/data/supabaseChamber.ts", 2],
  ["lib/data/supabaseFinance.ts", 2],
  ["lib/data/supabaseGamification.ts", 2],
  ["lib/data/supabaseRewardClaims.ts", 2],
  ["lib/data/supabaseWeeklyGamification.ts", 2],

  // Finance and workforce writers stamping RELIFE_SYSTEM tenant fields onto
  // rows. Accounting invariants stay independent of tenant routing, so these
  // move with the writers in Phase B/D rather than with the ledger identities.
  ["lib/domain/finance/cash.ts", 3],
  ["lib/domain/finance/expenses.ts", 3],
  ["lib/domain/finance/payments.ts", 2],
  ["lib/domain/finance/salary.ts", 2],
  ["lib/domain/workforce/sheetsIo.ts", 1],
]);

/** Total accepted compatibility debt at the close of Phase A. */
const LEDGER_TOTAL = 113;

const ROOTS = ["lib", "app", "supabase/functions"];
const REPO_ROOT = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function currentInventory(): Map<string, number> {
  const found = new Map<string, number>();
  for (const root of ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const source = readFileSync(file, "utf8");
      const matches = source.match(FIXED_IDENTIFIER);
      if (matches?.length) {
        found.set(relative(REPO_ROOT, file), matches.length);
      }
    }
  }
  return found;
}

test("no new production file introduces a fixed Relife identifier", () => {
  const current = currentInventory();
  const unlisted = [...current.keys()]
    .filter((file) => !COMPATIBILITY_LEDGER.has(file))
    .sort();

  assert.deepEqual(
    unlisted,
    [],
    `these files newly hardcode a Relife tenant identity and must resolve it from tenant context instead:\n${unlisted.join("\n")}`
  );
});

test("compatibility debt never grows, and shrinking updates the ledger", () => {
  const current = currentInventory();
  const drift: string[] = [];

  for (const [file, allowed] of COMPATIBILITY_LEDGER) {
    const actual = current.get(file) ?? 0;
    if (actual > allowed) {
      drift.push(`${file}: ${actual} occurrences, ledger allows ${allowed}`);
    } else if (actual < allowed) {
      drift.push(
        `${file}: down to ${actual} from ${allowed} — update the ledger to lock the improvement`
      );
    }
  }

  assert.deepEqual(drift, [], drift.join("\n"));
});

test("the Phase A configuration foundation carries no Relife identity", () => {
  for (const file of [
    "lib/domain/tenancy/clinicConfiguration.ts",
    "supabase/migrations/20260827130000_phase_a_clinic_configuration_foundation.sql",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /RELIFE-PHYSIO|RELIFE-DENTAL|amtali-main|"RELIFE"/,
      `${file} must stay tenant neutral`
    );
  }
});

test("the ledger is a real inventory, not an empty formality", () => {
  // Guards against the ledger being emptied to make the ratchet pass.
  assert.ok(COMPATIBILITY_LEDGER.size > 0);
  assert.equal(currentInventory().size, COMPATIBILITY_LEDGER.size);

  const total = [...COMPATIBILITY_LEDGER.values()].reduce((sum, n) => sum + n, 0);
  assert.equal(
    total,
    LEDGER_TOTAL,
    "LEDGER_TOTAL must track the ledger so the remaining debt stays visible in one number"
  );
});
