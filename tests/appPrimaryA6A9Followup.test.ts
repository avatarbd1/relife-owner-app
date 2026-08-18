import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const dailyPage = readFileSync(new URL("../app/(dashboard)/daily/page.tsx", import.meta.url), "utf8");
const dailyBoard = readFileSync(new URL("../components/DailyRegisterBoard.tsx", import.meta.url), "utf8");
const salaryPage = readFileSync(new URL("../app/(dashboard)/salary/page.tsx", import.meta.url), "utf8");
const salaryReport = readFileSync(new URL("../components/SalaryReportTools.tsx", import.meta.url), "utf8");
const salaryClient = readFileSync(new URL("../components/SalaryManagementClient.tsx", import.meta.url), "utf8");
const financeClient = readFileSync(new URL("../components/FinanceOperationsClient.tsx", import.meta.url), "utf8");
const ownerControls = readFileSync(new URL("../components/OwnerControlsClient.tsx", import.meta.url), "utf8");
const clinicalClient = readFileSync(new URL("../components/ClinicalWorkspaceClient.tsx", import.meta.url), "utf8");

function missing(path: string): boolean {
  return !existsSync(new URL(`../${path}`, import.meta.url));
}

describe("App-primary reviewed A6-A9 follow-up", () => {
  it("A6 adds a permission-aware Daily register summary without replacing the canonical register", () => {
    ok(dailyPage.includes("getDailyRegisterSnapshot"));
    ok(dailyPage.includes("DailyRegisterBoard"));
    ok(dailyBoard.includes('href="/register"'));
    ok(dailyBoard.includes("registerData.hasMoneyAccess"));
    ok(dailyBoard.includes("Patients treated"));
    equal(dailyBoard.includes("Net Collection"), false);
  });

  it("A7 keeps real finance APIs instead of the legacy placeholder server actions", () => {
    ok(financeClient.includes('"/api/finance/expense/request"'));
    ok(financeClient.includes('"/api/finance/cash/request"'));
    ok(ownerControls.includes('"/api/control/expense"'));
    ok(ownerControls.includes('"/api/control/cash-movement"'));
    ok(missing("app/(dashboard)/finance/operations/actions.ts"));
  });

  it("A8 adds read-only payroll reporting while the existing salary API remains the only writer", () => {
    ok(salaryPage.includes("SalaryReportTools"));
    ok(salaryClient.includes('"/api/finance/salary"'));
    equal(salaryReport.includes("fetch("), false);
    ok(salaryReport.includes("Export CSV"));
    ok(salaryReport.includes("Print report"));
    ok(missing("app/(dashboard)/salary/actions.ts"));
  });

  it("A9 stays on the canonical clinical workspace and does not introduce mock treatment writers", () => {
    ok(clinicalClient.includes('post("/api/clinical/session"'));
    ok(clinicalClient.includes("Same as last"));
    ok(clinicalClient.includes("Pain before · 0–10"));
    ok(missing("app/(dashboard)/treatment/actions.ts"));
  });
});
