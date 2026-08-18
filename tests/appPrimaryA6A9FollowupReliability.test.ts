import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

const dailyPage = readFileSync(new URL("../app/(dashboard)/daily/page.tsx", import.meta.url), "utf8");
const dailyBoard = readFileSync(new URL("../components/DailyRegisterBoard.tsx", import.meta.url), "utf8");
const salaryReport = readFileSync(new URL("../components/SalaryReportTools.tsx", import.meta.url), "utf8");
const migrationAudit = readFileSync(new URL("../MIGRATION_AUDIT.md", import.meta.url), "utf8");

describe("A6-A9 follow-up reliability", () => {
  it("keeps Daily core operational when optional summaries fail", () => {
    ok(dailyPage.includes("Daily register summary failed:"));
    ok(dailyPage.includes("Daily inventory alert read failed:"));
    ok(dailyPage.includes("unavailable: true"));
    ok(dailyBoard.includes("Register summary unavailable"));
  });

  it("does not expose register money without amount visibility", () => {
    ok(dailyBoard.includes("registerData.hasMoneyAccess"));
    ok(dailyBoard.includes("row.moneyVisible !== false"));
  });

  it("hardens payroll exports while remaining read-only", () => {
    ok(salaryReport.includes("spreadsheet-formula") || salaryReport.includes("/^[=+\\-@]/"));
    ok(salaryReport.includes("escapeHtml"));
    ok(salaryReport.includes("URL.revokeObjectURL"));
    equal(salaryReport.includes("/api/finance/salary"), false);
    equal(salaryReport.includes("<script>"), false);
  });

  it("documents that the follow-up does not switch Sheets or Supabase authority", () => {
    ok(migrationAudit.includes("Google Sheets remains the current operational source of truth"));
    ok(migrationAudit.includes("Supabase remains available for distributed locking and finance shadow/audit"));
    ok(migrationAudit.includes("must not silently change database authority"));
  });
});
