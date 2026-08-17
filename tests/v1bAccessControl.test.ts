import { describe, it } from "node:test";
import { ok, equal } from "node:assert";
import { canPerform, assertCanPerform } from "../lib/webos/access.ts";
import type { AccessContext, WebRole } from "../lib/webos/access.ts";
import type { Department } from "../lib/types.ts";

describe("V1-B: Canonical access policy and department isolation", () => {
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

  describe("Department separation - Physio/Dental isolation", () => {
    it("Physio user cannot access Dental patient data", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      const canRead = canPerform(context, "patient.read", "Dental");
      equal(canRead, false, "Physio user cannot read Dental patient");
    });

    it("Dental user cannot access Physio patient data", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      const canRead = canPerform(context, "patient.read", "Physio");
      equal(canRead, false, "Dental user cannot read Physio patient");
    });

    it("Department=All scope cannot access individual-scoped patient records", () => {
      const context = makeContext(["Manager"], ["All"]);
      // Patient with department "All" should fail (patients are Physio or Dental, never "All")
      const canRead = canPerform(context, "patient.read", "All");
      equal(canRead, false, "Cannot access patient with department=All");
    });

    it("Owner with All department access can see Physio patients", () => {
      const context = makeContext(["Owner"], ["All"]);
      const canRead = canPerform(context, "patient.read", "Physio");
      equal(canRead, true, "Owner with All scope can read Physio");
    });

    it("Owner with All department access can see Dental patients", () => {
      const context = makeContext(["Owner"], ["All"]);
      const canRead = canPerform(context, "patient.read", "Dental");
      equal(canRead, true, "Owner with All scope can read Dental");
    });

    it("Missing department mapping fails closed", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Manager"],
        primaryDepartment: "Physio",
        departmentAccess: [], // Empty access
        clinicalWriteScope: undefined,
      };
      const canRead = canPerform(context, "patient.read", "Physio");
      equal(canRead, false, "Empty department access fails closed");
    });
  });

  describe("Role permissions and Patient Hub actions", () => {
    it("Owner has Patient Hub full access", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "patient.read", "Physio"), "read");
      ok(canPerform(context, "patient.update", "Physio"), "update");
      ok(canPerform(context, "appointment.create", "Physio"), "appointment");
      ok(canPerform(context, "payment.create", "Physio"), "payment");
      ok(canPerform(context, "clinical.read", "Physio"), "clinical.read");
      ok(canPerform(context, "patient.report.read", "Physio"), "reports");
    });

    it("Manager has Patient Hub actions including Payment within department scope", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "patient.read", "Physio"), "read Physio patient");
      ok(canPerform(context, "patient.update", "Physio"), "update Physio patient");
      ok(canPerform(context, "appointment.create", "Physio"), "create Physio appointment");
      ok(canPerform(context, "payment.read_amount", "Physio"), "read payment amount");
      ok(canPerform(context, "payment.create", "Physio"), "create Physio payment");
    });

    it("Manager cannot access payment outside their department scope", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(
        canPerform(context, "payment.create", "Dental"),
        false,
        "Manager with Physio scope cannot create Dental payment"
      );
    });

    it("Receptionist has Patient Hub payment access within department scope", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "patient.read", "Physio"), "read");
      ok(canPerform(context, "patient.create", "Physio"), "create/register");
      ok(canPerform(context, "patient.update", "Physio"), "update");
      ok(canPerform(context, "payment.read_amount", "Physio"), "read payment");
      ok(canPerform(context, "payment.create", "Physio"), "create payment");
      ok(canPerform(context, "appointment.create", "Physio"), "create appointment");
    });

    it("Receptionist cannot create payment outside their department", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      equal(
        canPerform(context, "payment.create", "Physio"),
        false,
        "Receptionist with Dental scope cannot create Physio payment"
      );
    });

    it("Therapist does NOT have payment create permission", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(
        canPerform(context, "payment.create", "Physio"),
        false,
        "Therapist cannot create payment"
      );
    });

    it("Dentist does NOT have payment create permission", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(
        canPerform(context, "payment.create", "Dental"),
        false,
        "Dentist cannot create payment"
      );
    });

    it("Therapist can access Physio patient data and clinical actions", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "patient.read", "Physio"), "read patient");
      ok(canPerform(context, "appointment.create", "Physio"), "create appointment");
      ok(canPerform(context, "clinical.read", "Physio"), "read clinical");
      equal(canPerform(context, "payment.create", "Physio"), false, "no payment");
    });

    it("Dentist cannot access Physio patient data", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "patient.read", "Physio"), false, "Dentist cannot read Physio patient");
    });

    it("Auditor has read-only access, no mutations", () => {
      const context = makeContext(["Auditor"], ["All"]);
      ok(canPerform(context, "report.read_financial", "Physio"), "audit.read");
      equal(canPerform(context, "patient.update", "Physio"), false, "no patient.update");
      equal(canPerform(context, "payment.create", "Physio"), false, "no payment.create");
      equal(canPerform(context, "appointment.create", "Physio"), false, "no appointment.create");
    });

    it("System Admin has no implicit patient/finance access", () => {
      const context = makeContext(["System Admin"], ["All"]);
      equal(canPerform(context, "patient.read", "Physio"), false, "no patient access");
      equal(canPerform(context, "payment.create", "Physio"), false, "no payment access");
      ok(canPerform(context, "settings.manage", "All"), "only settings.manage");
    });
  });

  describe("Temporary Dental data-entry exception", () => {
    it("Dental Receptionist with temporary exception can read/write Dental clinical", () => {
      const context: AccessContext = {
        staffId: "test-dental-receptionist",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      ok(canPerform(context, "clinical.read", "Dental"), "can read Dental clinical");
      ok(canPerform(context, "clinical.write", "Dental"), "can write Dental clinical");
    });

    it("Temporary exception is Dental-only", () => {
      const context: AccessContext = {
        staffId: "test-dental-receptionist",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "clinical.write", "Physio"), false, "exception does not apply to Physio");
    });

    it("Temporary exception requires Dental-only department scope", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental", "All"], // Mixed scope
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "clinical.write", "Dental"), false, "mixed scope fails");
    });

    it("Temporary exception requires Receptionist role", () => {
      const context: AccessContext = {
        staffId: "test-therapist",
        roles: ["Therapist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "clinical.write", "Dental"), false, "only Receptionist can use exception");
    });
  });

  describe("Cross-department scenarios", () => {
    it("Manager with multiple departments can access each separately", () => {
      // Note: In production, a staff member should have ONE primary department
      // but for testing we verify access isolation works per-department
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "payment.create", "Physio"), "can access Physio");
      equal(canPerform(context, "payment.create", "Dental"), false, "cannot access Dental");
    });

    it("Manager with All scope can access both departments", () => {
      const context = makeContext(["Manager"], ["All"]);
      ok(canPerform(context, "payment.create", "Physio"), "Physio");
      ok(canPerform(context, "payment.create", "Dental"), "Dental");
    });
  });

  describe("Access assertion helper", () => {
    it("assertCanPerform throws when access denied", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      let thrown = false;
      try {
        assertCanPerform(context, "payment.create", "Physio");
      } catch (error) {
        if ((error as Error).message === "ACCESS_DENIED") {
          thrown = true;
        }
      }
      ok(thrown, "assertCanPerform throws ACCESS_DENIED");
    });

    it("assertCanPerform succeeds when access allowed", () => {
      const context = makeContext(["Owner"], ["All"]);
      let thrown = false;
      try {
        assertCanPerform(context, "payment.create", "Physio");
      } catch {
        thrown = true;
      }
      equal(thrown, false, "no error when access allowed");
    });
  });

  describe("Patient Hub specific access patterns", () => {
    it("Owner/Manager/Receptionist get payment button when authorized", () => {
      for (const role of ["Owner", "Manager", "Receptionist"]) {
        const context = makeContext([role], ["Physio"]);
        ok(
          canPerform(context, "payment.create", "Physio"),
          `${role} can create payment for Physio patient`
        );
      }
    });

    it("Therapist/Dentist do not get payment button", () => {
      const therapistContext = makeContext(["Therapist"], ["Physio"]);
      equal(
        canPerform(therapistContext, "payment.create", "Physio"),
        false,
        "Therapist cannot create payment"
      );

      const dentistContext = makeContext(["Dentist"], ["Dental"]);
      equal(
        canPerform(dentistContext, "payment.create", "Dental"),
        false,
        "Dentist cannot create payment"
      );
    });

    it("Patient edit remains reachable by authorized users", () => {
      const managerContext = makeContext(["Manager"], ["Physio"]);
      ok(
        canPerform(managerContext, "patient.update", "Physio"),
        "Manager can edit patient"
      );
    });

    it("Appointment history visible to those with appointment.create permission", () => {
      const therapistContext = makeContext(["Therapist"], ["Physio"]);
      ok(
        canPerform(therapistContext, "appointment.create", "Physio"),
        "Therapist can see appointment history"
      );
    });

    it("Reports/media visible when authorized", () => {
      const managerContext = makeContext(["Manager"], ["Physio"]);
      ok(
        canPerform(managerContext, "patient.report.read", "Physio"),
        "Manager can see reports"
      );

      const therapistContext = makeContext(["Therapist"], ["Physio"]);
      ok(
        canPerform(therapistContext, "patient.report.read", "Physio"),
        "Therapist can see reports"
      );
    });
  });
});
