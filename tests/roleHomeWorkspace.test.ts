import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

const homePage = readFileSync(
  new URL("../app/(dashboard)/home/page.tsx", import.meta.url),
  "utf8"
);
const staffHome = readFileSync(
  new URL("../lib/webos/staffHome.ts", import.meta.url),
  "utf8"
);
const staffUi = readFileSync(
  new URL("../components/StaffHomeWorkspace.tsx", import.meta.url),
  "utf8"
);

describe("role-aware Home workspace", () => {
  it("keeps Owner Home and routes supported staff roles into a real Home workspace", () => {
    ok(homePage.includes('context.roles.includes("Owner")'));
    ok(homePage.includes("resolveStaffHomeRole(context)"));
    ok(homePage.includes("getStaffHomeSnapshot(context, scope)"));
    ok(homePage.includes("<StaffHomeWorkspace snapshot={snapshot} />"));
    equal(homePage.includes('redirect("/daily");\n    }\n    return ('), false);
  });

  it("keeps Auditor and System Admin on their existing dedicated workspaces", () => {
    ok(homePage.includes('context.roles.includes("Auditor")'));
    ok(homePage.includes('redirect("/reports")'));
    ok(homePage.includes('context.roles.includes("System Admin")'));
    ok(homePage.includes('redirect("/tools")'));
  });

  it("filters clinician Home schedule to the signed-in clinician", () => {
    ok(staffHome.includes("belongsToCurrentClinician"));
    ok(staffHome.includes("appointment.therapist"));
    ok(staffHome.includes("context.staffId"));
    ok(staffHome.includes("staffName"));
    ok(staffHome.includes("appointments.filter"));
  });

  it("derives staff shortcuts from canonical RBAC instead of UI-only role assumptions", () => {
    ok(staffHome.includes("canPerform(context, action, department)"));
    ok(staffHome.includes('patientCreate: canInScope(context, scope, "patient.create")'));
    ok(staffHome.includes('paymentCreate: canInScope(context, scope, "payment.create")'));
    ok(staffHome.includes('chamberRun: canInScope(context, scope, "chamber.run")'));
    ok(staffUi.includes("capabilities.patientCreate"));
    ok(staffUi.includes("capabilities.paymentCreate"));
    ok(staffUi.includes("capabilities.chamberRun"));
  });

  it("does not add a parallel finance or clinical mutation path to Home", () => {
    equal(staffUi.includes("/api/"), false);
    equal(staffHome.includes("getTodaysCollection"), false);
    equal(staffHome.includes("getScopedCashPosition"), false);
    ok(staffUi.includes("/patients/"));
    ok(staffUi.includes("/appointments"));
  });
});
