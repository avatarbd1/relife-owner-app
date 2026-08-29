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

  it("uses clinician-first staff Home role precedence", () => {
    const therapist = staffHome.indexOf('context.roles.includes("Therapist")');
    const dentist = staffHome.indexOf('context.roles.includes("Dentist")');
    const reception = staffHome.indexOf('context.roles.includes("Receptionist")');
    const manager = staffHome.indexOf('context.roles.includes("Manager")');
    ok(therapist >= 0 && dentist > therapist && reception > dentist && manager > reception);
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
    ok(staffHome.includes('patientCreate: patientsEnabled && canInScope(context, scope, "patient.create")'));
    ok(staffHome.includes('paymentCreate: financeEnabled && canInScope(context, scope, "payment.create")'));
    ok(staffHome.includes('cashRequest: advancedFinanceEnabled && canInScope(context, scope, "cash.request")'));
    ok(staffHome.includes('chamberRun: chamberEnabled && canInScope(context, scope, "chamber.run")'));
    ok(staffUi.includes("capabilities.patientCreate"));
    ok(staffUi.includes("capabilities.paymentCreate"));
    ok(staffUi.includes("capabilities.cashRequest"));
    ok(staffUi.includes("capabilities.chamberRun"));
  });

  it("keeps the staff Home task-first instead of turning it into an ERP dashboard", () => {
    ok(staffUi.includes('label: "New patient"'));
    ok(staffUi.includes('label: "Booking"'));
    ok(staffUi.includes('label: "Payment"'));
    ok(staffUi.includes('label: "Handover"'));
    ok(staffUi.includes('"My patients today"'));
    ok(staffUi.includes('"Today’s queue"'));
    ok(staffUi.includes("Tap a patient to continue the work"));
    equal(staffUi.includes("MetricGrid"), false);
    equal(staffUi.includes("Work shortcuts"), false);
  });

  it("does not add a parallel finance or clinical mutation path to Home", () => {
    equal(staffUi.includes("/api/"), false);
    equal(staffHome.includes("getTodaysCollection"), false);
    equal(staffHome.includes("getScopedCashPosition"), false);
    ok(staffUi.includes("/patients/"));
    ok(staffUi.includes("/appointments"));
  });
});
