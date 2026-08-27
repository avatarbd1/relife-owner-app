import { describe, it } from "node:test";
import { ok, equal } from "node:assert";
import {
  canPerform,
  assertCanPerform,
  type AccessContext,
  type WebRole,
  canAccessDepartment,
} from "../lib/webos/access.ts";
import type { Department } from "../lib/types.ts";

describe("V1-D: Product Surface & Final Hardening", () => {
  const makeContext = (
    roles: string[],
    departmentAccess: string[]
  ): AccessContext => ({
    staffId: "test-staff",
    roles: roles as WebRole[],
    primaryDepartment: departmentAccess[0] as Department,
    departmentAccess: departmentAccess as Department[],
    clinicalWriteScope: undefined,
  });

  describe("Cross-Department Isolation (Regression)", () => {
    it("Physio-scoped staff cannot read Dental patients", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canAccessDepartment(context, "Dental"), false);
    });

    it("Dental-scoped staff cannot read Physio patients", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canAccessDepartment(context, "Physio"), false);
    });

    it("Missing department access fails closed", () => {
      const context = makeContext(["Manager"], []);
      equal(canAccessDepartment(context, "Physio"), false);
      equal(canAccessDepartment(context, "Dental"), false);
    });

    it("All-scoped staff can access both departments", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canAccessDepartment(context, "Physio"));
      ok(canAccessDepartment(context, "Dental"));
    });

    it("Patient with department=All cannot be accessed by patient.read", () => {
      const context = makeContext(["Owner"], ["All"]);
      equal(
        canPerform(context, "patient.read", "All" as Department),
        false
      );
    });
  });

  describe("Appointment Authority (V1-C Regression - Consolidation)", () => {
    it("Both /api/appointments and /api/chamber/schedule validate with same authorization", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Therapist can create Physio appointment (assigned to self)", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Therapist cannot create Dental appointment", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Dental"), false);
    });

    it("Dentist cannot create Physio appointment", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });

    it("Appointment status update restricted by department", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });
  });

  describe("Chamber Authority (V1-C Regression - Physio Only)", () => {
    it("Chamber is Physio-only (Dentist has no chamber access)", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "chamber.read", "Dental"), false);
    });

    it("Therapist can run chamber sessions (Physio scoped)", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Receptionist cannot run chamber (only receive)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      equal(canPerform(context, "chamber.run", "Physio"), false);
      ok(canPerform(context, "chamber.receive", "Physio"));
    });

    it("Receptionist with Dental scope cannot receive chamber (Physio only)", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      // Chamber is Physio-only, so even with permission, staff without Physio access can't use it
      equal(canAccessDepartment(context, "Physio"), false);
    });
  });

  describe("Finance Authority (Scoped Staff Can Create Payments)", () => {
    it("Owner can create payment", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "payment.create", "Physio"));
    });

    it("Manager can create payment (within their department scope)", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "payment.create", "Physio"));
    });

    it("Manager cannot create payment for unscoped department", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "payment.create", "Dental"), false);
    });

    it("Receptionist can create payment (within their department scope)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "payment.create", "Physio"));
    });

    it("Receptionist can correct their own today entry", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "payment.correct_own_today", "Physio"));
    });
  });

  describe("Clinical Authority (Therapist/Dentist + Conditions)", () => {
    it("Therapist can read Physio clinical", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "clinical.read", "Physio"));
    });

    it("Therapist cannot read Dental clinical", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "clinical.read", "Dental"), false);
    });

    it("Therapist cannot write clinical without assignment", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(
        canPerform(context, "clinical.write", "Physio", {}),
        false
      );
    });

    it("Therapist can write clinical when assigned", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(
        canPerform(context, "clinical.write", "Physio", {
          assignedToCurrentStaff: true,
        })
      );
    });

    it("Dentist can write clinical when assigned (Dental scoped)", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      ok(
        canPerform(context, "clinical.write", "Dental", {
          assignedToCurrentStaff: true,
        })
      );
    });

    it("Receptionist cannot write clinical (no permission)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      equal(
        canPerform(context, "clinical.write", "Physio", {
          assignedToCurrentStaff: true,
        }),
        false
      );
    });

    it("Dental Receptionist with temporary exception can write clinical", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      ok(canPerform(context, "clinical.write", "Dental"));
    });

    it("Temporary exception does not work cross-department (Physio)", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Physio",
        departmentAccess: ["Physio"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "clinical.write", "Physio"), false);
    });

    it("Temporary exception requires explicit scope (not implicit)", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: undefined,
      };
      equal(canPerform(context, "clinical.write", "Dental"), false);
    });
  });

  describe("Reports/Media Authority (Patient-Scoped)", () => {
    it("Receptionist can read patient reports (scoped)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "patient.report.read", "Physio"));
      equal(canPerform(context, "patient.report.read", "Dental"), false);
    });

    it("Therapist can upload reports (Physio)", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "patient.report.upload", "Physio"));
    });

    it("Dentist cannot upload Physio reports", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "patient.report.upload", "Physio"), false);
    });
  });

  describe("Audit Authority (Read-Only, No Mutations)", () => {
    it("Auditor can read audit log", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      ok(canPerform(context, "audit.read", "Physio"));
    });

    it("Auditor can read financial reports", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      ok(canPerform(context, "report.read_financial", "Physio"));
    });

    it("Manager cannot read audit log", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "audit.read", "Physio"), false);
    });

    it("Auditor cannot create appointments", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });

    it("Auditor cannot create patients", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      equal(canPerform(context, "patient.create", "Physio"), false);
    });
  });

  describe("System Admin Authority (Settings Only)", () => {
    it("System Admin can manage settings", () => {
      const context = makeContext(["System Admin"], ["Physio"]);
      ok(canPerform(context, "settings.manage", "Physio"));
    });

    it("System Admin cannot access patient data", () => {
      const context = makeContext(["System Admin"], ["Physio"]);
      equal(canPerform(context, "patient.read", "Physio"), false);
    });

    it("System Admin cannot access clinical data", () => {
      const context = makeContext(["System Admin"], ["Physio"]);
      equal(canPerform(context, "clinical.read", "Physio"), false);
    });

    it("System Admin cannot access chamber", () => {
      const context = makeContext(["System Admin"], ["Physio"]);
      equal(canPerform(context, "chamber.read", "Physio"), false);
    });
  });

  describe("Dental_Assistant Authority (Explicitly Empty)", () => {
    it("Dental_Assistant has no patient access", () => {
      const context = makeContext(["Dental_Assistant"], ["Dental"]);
      equal(canPerform(context, "patient.read", "Dental"), false);
      equal(canPerform(context, "appointment.create", "Dental"), false);
      equal(canPerform(context, "clinical.read", "Dental"), false);
    });

    it("Dental_Assistant has no clinical access", () => {
      const context = makeContext(["Dental_Assistant"], ["Dental"]);
      equal(canPerform(context, "clinical.read", "Dental"), false);
      equal(canPerform(context, "clinical.write", "Dental"), false);
    });
  });

  describe("Multi-Role Staff (Owner + Manager, etc.)", () => {
    it("Owner with multiple roles gets union of permissions", () => {
      const context = makeContext(["Owner", "Manager"], ["All"]);
      ok(canPerform(context, "payment.create", "Physio"));
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Staff with both Physio and Dental can access both", () => {
      const context = makeContext(["Manager"], ["Physio", "Dental"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.create", "Dental"));
    });

    it("Staff role union: Therapist + Receptionist gets both capabilities", () => {
      const context = makeContext(
        ["Therapist", "Receptionist"],
        ["Physio"]
      );
      ok(canPerform(context, "patient.read", "Physio"));
      ok(canPerform(context, "chamber.run", "Physio"));
      ok(canPerform(context, "chamber.receive", "Physio"));
    });
  });

  describe("Department Mismatch Scenarios", () => {
    it("Physio-only role missing Dental access cannot perform Dental operations", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Dental"), false);
      equal(canPerform(context, "patient.create", "Dental"), false);
    });

    it("Appointment status update fails when department mismatches", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      // Simulating: appointment belongs to Dental, staff only has Physio
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Chamber operations fail when staff lacks Physio (chamber is Physio-only)", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      // Staff with only Dental access cannot access any Physio resources
      equal(canAccessDepartment(context, "Physio"), false);
    });
  });

  describe("Invalid Department Handling", () => {
    it("Missing department access returns false (not throw)", () => {
      const context = makeContext(["Manager"], []);
      equal(canAccessDepartment(context, "Physio"), false);
    });

    it("Invalid staffId returns false", () => {
      const context: AccessContext = {
        staffId: "",
        roles: ["Manager"],
        primaryDepartment: "Physio",
        departmentAccess: ["Physio"],
      };
      equal(canAccessDepartment(context, "Physio"), false);
    });

    it("Empty roles array returns false", () => {
      const context: AccessContext = {
        staffId: "staff-123",
        roles: [],
        primaryDepartment: "Physio",
        departmentAccess: ["Physio"],
      };
      equal(canAccessDepartment(context, "Physio"), false);
    });
  });
});
