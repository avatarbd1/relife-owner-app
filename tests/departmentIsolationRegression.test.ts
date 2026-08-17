import { describe, it } from "node:test";
import { ok, equal } from "node:assert";
import { canPerform } from "../lib/webos/access.ts";
import type { AccessContext } from "../lib/webos/access.ts";

describe("Department isolation: direct ID/API bypass regression", () => {
  const makeContext = (
    roles: string[],
    departmentAccess: string[]
  ): AccessContext => ({
    staffId: "test-staff",
    roles: roles as any,
    primaryDepartment: departmentAccess[0] as any,
    departmentAccess: departmentAccess as any,
    clinicalWriteScope: undefined,
  });

  describe("Physio users cannot access Dental via direct patient ID", () => {
    it("Physio Manager cannot read Dental patient directly", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "patient.read", "Dental"), false);
    });

    it("Physio Receptionist cannot create payment for Dental patient", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      equal(canPerform(context, "payment.create", "Dental"), false);
    });

    it("Physio Therapist cannot access Dental clinical data", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "clinical.read", "Dental"), false);
    });

    it("Physio Therapist cannot write Dental clinical data", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(
        canPerform(context, "clinical.write", "Dental", { assignedToCurrentStaff: true }),
        false
      );
    });
  });

  describe("Dental users cannot access Physio via direct patient ID", () => {
    it("Dental Manager cannot read Physio patient directly", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canPerform(context, "patient.read", "Physio"), false);
    });

    it("Dental Receptionist cannot create payment for Physio patient", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      equal(canPerform(context, "payment.create", "Physio"), false);
    });

    it("Dental Dentist cannot access Physio clinical data", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "clinical.read", "Physio"), false);
    });

    it("Dental Dentist cannot write Physio clinical data", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(
        canPerform(context, "clinical.write", "Physio", { assignedToCurrentStaff: true }),
        false
      );
    });
  });

  describe("Missing department mapping fails closed", () => {
    it("Staff with no department access cannot read any patient", () => {
      const context = makeContext(["Manager"], []);
      equal(canPerform(context, "patient.read", "Physio"), false);
      equal(canPerform(context, "patient.read", "Dental"), false);
    });

    it("Staff with no department access cannot create appointments", () => {
      const context = makeContext(["Receptionist"], []);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Dental"), false);
    });

    it("Staff with no department access cannot perform any patient operation", () => {
      const context = makeContext(["Owner"], []);
      equal(canPerform(context, "patient.read", "Physio"), false);
      equal(canPerform(context, "patient.create", "Dental"), false);
      equal(canPerform(context, "patient.update", "Physio"), false);
      equal(canPerform(context, "payment.create", "Dental"), false);
      equal(canPerform(context, "clinical.read", "Physio"), false);
      equal(canPerform(context, "clinical.write", "Dental"), false);
    });
  });

  describe("All-scoped access works correctly for authorized roles", () => {
    it("Owner with All scope can read both departments", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "patient.read", "Physio"));
      ok(canPerform(context, "patient.read", "Dental"));
    });

    it("Owner with All scope can write clinical in both departments", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "clinical.read", "Physio"));
      ok(canPerform(context, "clinical.read", "Dental"));
      ok(canPerform(context, "clinical.write", "Physio"));
      ok(canPerform(context, "clinical.write", "Dental"));
    });

    it("Auditor with All scope can read financial reports in both", () => {
      const context = makeContext(["Auditor"], ["All"]);
      ok(canPerform(context, "report.read_financial", "Physio"));
      ok(canPerform(context, "report.read_financial", "Dental"));
    });

    it("Auditor with All scope still cannot mutate patients", () => {
      const context = makeContext(["Auditor"], ["All"]);
      equal(canPerform(context, "patient.create", "Physio"), false);
      equal(canPerform(context, "patient.update", "Dental"), false);
      equal(canPerform(context, "payment.create", "Physio"), false);
    });
  });

  describe("Single-department scope cannot be bypassed by API", () => {
    it("Manager scoped to Physio cannot read Dental via API", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      // API validation: department check fails
      equal(canPerform(context, "patient.read", "Dental"), false);
      equal(canPerform(context, "patient.update", "Dental"), false);
      equal(canPerform(context, "payment.create", "Dental"), false);
    });

    it("Manager scoped to Dental cannot read Physio via API", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canPerform(context, "patient.read", "Physio"), false);
      equal(canPerform(context, "patient.update", "Physio"), false);
      equal(canPerform(context, "payment.create", "Physio"), false);
    });

    it("Receptionist cannot bypass their single-department scope", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      // Even if Receptionist has payment.create permission, they can't use it for Dental
      equal(canPerform(context, "payment.create", "Dental"), false);
      equal(canPerform(context, "appointment.create", "Dental"), false);
    });
  });

  describe("Role permissions are still enforced per department", () => {
    it("Therapist can read Physio but not create payments", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "patient.read", "Physio"));
      equal(canPerform(context, "payment.create", "Physio"), false);
    });

    it("Dentist can read Dental but not create payments", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      ok(canPerform(context, "patient.read", "Dental"));
      equal(canPerform(context, "payment.create", "Dental"), false);
    });

    it("Auditor cannot mutate even with Physio access", () => {
      const context = makeContext(["Auditor"], ["Physio"]);
      equal(canPerform(context, "patient.create", "Physio"), false);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "payment.create", "Physio"), false);
    });
  });
});
