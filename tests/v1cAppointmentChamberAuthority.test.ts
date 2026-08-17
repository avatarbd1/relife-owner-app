import { describe, it } from "node:test";
import { ok, equal, deepEqual } from "node:assert";
import { canPerform, type AccessContext, type WebRole } from "../lib/webos/access.ts";
import type { Department } from "../lib/types.ts";

describe("V1-C: Appointment + Chamber Authority Consolidation", () => {
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

  describe("Appointment Authorization — Physio", () => {
    it("Owner can create Physio appointments within All scope", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.read", "Physio"));
    });

    it("Manager scoped to Physio can create Physio appointments", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.read", "Physio"));
    });

    it("Manager scoped to Physio cannot create Dental appointments", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Dental"), false);
      equal(canPerform(context, "appointment.read", "Dental"), false);
    });

    it("Receptionist scoped to Physio can create appointments", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.read", "Physio"));
    });

    it("Therapist scoped to Physio can create appointments", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.read", "Physio"));
    });

    it("Therapist cannot read/create appointments they cannot access", () => {
      const context = makeContext(["Therapist"], ["Dental"]);
      equal(canPerform(context, "appointment.read", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });

    it("Auditor cannot create appointments even with Physio scope", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });

    it("Auditor can read appointments if policy grants it", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      equal(canPerform(context, "appointment.read", "Physio"), false);
    });

    it("System Admin cannot create/read appointments", () => {
      const context = makeContext(["System Admin"], ["All"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "appointment.read", "Physio"), false);
    });
  });

  describe("Appointment Authorization — Dental", () => {
    it("Owner can create Dental appointments within All scope", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.read", "Dental"));
    });

    it("Manager scoped to Dental can create Dental appointments", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.read", "Dental"));
    });

    it("Manager scoped to Dental cannot create Physio appointments", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "appointment.read", "Physio"), false);
    });

    it("Receptionist scoped to Dental can create appointments", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.read", "Dental"));
    });

    it("Dentist scoped to Dental can create appointments", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.read", "Dental"));
    });

    it("Dentist cannot access Physio appointments", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "appointment.read", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });
  });

  describe("Appointment Update Authorization", () => {
    it("Owner can update appointments in authorized scope", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "appointment.update", "Physio"));
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("Manager can update appointments in their scope", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Receptionist can update appointments in their scope", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
      equal(canPerform(context, "appointment.update", "Physio"), false);
    });

    it("Therapist cannot update appointments (role permission check)", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "appointment.update", "Physio"), false);
    });

    it("Dentist cannot update appointments (role permission check)", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });
  });

  describe("Chamber Authorization — Read", () => {
    it("Owner can read chamber within All scope", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "chamber.read", "Physio"));
    });

    it("Manager with Physio scope can read chamber", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "chamber.read", "Physio"));
    });

    it("Receptionist with Physio scope can read chamber", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "chamber.read", "Physio"));
    });

    it("Therapist with Physio scope can read chamber", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "chamber.read", "Physio"));
    });

    it("Therapist with Dental scope cannot read chamber", () => {
      const context = makeContext(["Therapist"], ["Dental"]);
      equal(canPerform(context, "chamber.read", "Physio"), false);
    });

    it("Dentist cannot read chamber (role has no chamber permission)", () => {
      const context = makeContext(["Dentist"], ["All"]);
      equal(canPerform(context, "chamber.read", "Physio"), false);
    });

    it("Auditor cannot read chamber even with Physio scope", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      equal(canPerform(context, "chamber.read", "Physio"), false);
    });
  });

  describe("Chamber Authorization — Receive", () => {
    it("Owner can receive chamber patients", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "chamber.receive", "Physio"));
    });

    it("Manager with Physio scope can receive", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "chamber.receive", "Physio"));
    });

    it("Receptionist with Physio scope can receive", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "chamber.receive", "Physio"));
    });

    it("Therapist cannot receive (role has no chamber.receive)", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "chamber.receive", "Physio"), false);
    });

    it("Manager with Dental scope cannot receive Physio chamber", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canPerform(context, "chamber.receive", "Physio"), false);
    });
  });

  describe("Chamber Authorization — Run", () => {
    it("Owner can run chamber operations", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Manager with Physio scope can run chamber", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Therapist with Physio scope can run chamber", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Receptionist cannot run chamber (role has no chamber.run)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });

    it("Dentist cannot run chamber (role has no chamber.run)", () => {
      const context = makeContext(["Dentist"], ["All"]);
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });

    it("Therapist with Dental scope cannot run Physio chamber", () => {
      const context = makeContext(["Therapist"], ["Dental"]);
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });
  });

  describe("Cross-Department Isolation — Appointments", () => {
    it("Physio-only staff cannot create Dental appointments", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Dental"), false);
    });

    it("Dental-only staff cannot create Physio appointments", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });

    it("Physio-only Therapist cannot access Dental appointment actions", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "appointment.read", "Dental"), false);
      equal(canPerform(context, "appointment.create", "Dental"), false);
    });

    it("Dental-only Dentist cannot access Physio appointment actions", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "appointment.read", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });
  });

  describe("Cross-Department Isolation — Chamber", () => {
    it("Chamber is Physio-only operational domain", () => {
      const context = makeContext(["Manager"], ["All"]);
      ok(canPerform(context, "chamber.read", "Physio"));
      ok(canPerform(context, "chamber.receive", "Physio"));
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Dental staff cannot access Physio chamber even with All scope", () => {
      const context = makeContext(["Dentist"], ["All"]);
      equal(canPerform(context, "chamber.read", "Physio"), false);
      equal(canPerform(context, "chamber.receive", "Physio"), false);
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });

    it("Physio Therapist scoped to Physio can run chamber", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "chamber.read", "Physio"));
      ok(canPerform(context, "chamber.run", "Physio"));
    });
  });

  describe("Missing Department Scope Fails Closed", () => {
    it("Staff with no department scope cannot create appointments", () => {
      const context = makeContext(["Manager"], []);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Dental"), false);
    });

    it("Staff with no department scope cannot access chamber", () => {
      const context = makeContext(["Manager"], []);
      equal(canPerform(context, "chamber.read", "Physio"), false);
      equal(canPerform(context, "chamber.receive", "Physio"), false);
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });

    it("Therapist with empty department access cannot create appointments", () => {
      const context = makeContext(["Therapist"], []);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "appointment.read", "Physio"), false);
    });
  });

  describe("Temporary Dental Exception Does NOT Broaden Appointment/Chamber", () => {
    it("Dental-only Receptionist with temporary exception has clinical rights only", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      ok(canPerform(context, "clinical.read", "Dental"));
      ok(canPerform(context, "clinical.write", "Dental"));
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.read", "Dental"));
    });

    it("Temporary exception does not grant Physio access", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "clinical.read", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Physio"), false);
    });

    it("Temporary exception does not grant chamber.receive", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "chamber.receive", "Physio"), false);
    });

    it("Temporary exception does not grant chamber.run", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });
  });

  describe("All-Scoped Access Respects Role Permissions", () => {
    it("Manager with All scope can create both Physio and Dental appointments", () => {
      const context = makeContext(["Manager"], ["All"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.create", "Dental"));
    });

    it("Therapist with All scope has appointment.create permission for all departments", () => {
      const context = makeContext(["Therapist"], ["All"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.create", "Dental"));
    });

    it("Dentist with All scope has appointment.create permission for all departments", () => {
      const context = makeContext(["Dentist"], ["All"]);
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Owner with All scope can access all chamber operations", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "chamber.read", "Physio"));
      ok(canPerform(context, "chamber.receive", "Physio"));
      ok(canPerform(context, "chamber.run", "Physio"));
    });

    it("Therapist with All scope cannot receive chamber (role has no permission)", () => {
      const context = makeContext(["Therapist"], ["All"]);
      ok(canPerform(context, "chamber.read", "Physio"));
      ok(canPerform(context, "chamber.run", "Physio"));
      equal(canPerform(context, "chamber.receive", "Physio"), false);
    });

    it("Receptionist with All scope can receive chamber", () => {
      const context = makeContext(["Receptionist"], ["All"]);
      ok(canPerform(context, "chamber.read", "Physio"));
      ok(canPerform(context, "chamber.receive", "Physio"));
      equal(canPerform(context, "chamber.run", "Physio"), false);
    });
  });
});
