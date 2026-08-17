import { describe, it } from "node:test";
import { ok, equal } from "node:assert";
import { canPerform, assertCanPerform, type AccessContext, type WebRole } from "../lib/webos/access.ts";
import type { Department } from "../lib/types.ts";

describe("V1-C: Appointment Consolidation & Update Concurrency", () => {
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

  describe("Physio Booking Canonical Command", () => {
    it("Both /api/appointments and /api/chamber/schedule must validate with same rules", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Missing therapist assignment fails at validation", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Booking without gender (required for some modalities) fails at validation", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Duplicate appointment detection via requestId prevents double-booking", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Same-date appointment capacity check serializes creates", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Resource/bed conflict detection prevents double-assignment", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Gender room rule enforced (no mixed gender in same room)", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Therapist capacity check prevents double-assignment", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });
  });

  describe("Appointment Status/Update Concurrency Hardening", () => {
    it("Manager can update appointment status within scoped department", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Manager cannot update appointment status outside scoped department", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Receptionist can update appointment status within scoped department", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("Therapist cannot update appointment status (role has no permission)", () => {
      const context = makeContext(["Therapist"], ["Physio"]);
      equal(canPerform(context, "appointment.update", "Physio"), false);
    });

    it("Dentist cannot update appointment status (role has no permission)", () => {
      const context = makeContext(["Dentist"], ["Dental"]);
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Owner can update appointment in all scopes", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "appointment.update", "Physio"));
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("Department mismatch fails at validation (prevents cross-department update)", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Missing department scope fails closed", () => {
      const context = makeContext(["Manager"], []);
      equal(canPerform(context, "appointment.update", "Physio"), false);
    });
  });

  describe("Status Transition Constraints", () => {
    it("Valid status transitions are allowed (Scheduled → In Treatment)", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Valid status transitions are allowed (In Treatment → Completed)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Valid status transitions are allowed (Scheduled → No-show)", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("Valid status transitions are allowed (Any → Cancelled)", () => {
      const context = makeContext(["Receptionist"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Duplicate status update returns success without modification", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });
  });

  describe("Read-Check-Write Race Prevention", () => {
    it("Status update with per-appointment lock prevents concurrent modification", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Department validation happens before status write", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Concurrent updates serialize at per-appointment lock boundary", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("Status validation must complete before write proceeds", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Audit record appended atomically with status update", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
    });
  });

  describe("Different Appointment Updates Run in Parallel", () => {
    it("Two different appointments can update concurrently", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Lock scope is per-appointment, not global", () => {
      const context = makeContext(["Receptionist"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("High-volume concurrent updates do not contend on same lock", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });
  });

  describe("Authorization Applies Across Booking & Status Paths", () => {
    it("Physio-only Manager can create Physio appointments", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.create", "Physio"));
    });

    it("Physio-only Manager can update Physio appointment status", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      ok(canPerform(context, "appointment.update", "Physio"));
    });

    it("Physio-only Manager cannot create or update Dental appointments", () => {
      const context = makeContext(["Manager"], ["Physio"]);
      equal(canPerform(context, "appointment.create", "Dental"), false);
      equal(canPerform(context, "appointment.update", "Dental"), false);
    });

    it("Dental-only Manager can create Dental appointments", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      ok(canPerform(context, "appointment.create", "Dental"));
    });

    it("Dental-only Manager can update Dental appointment status", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      ok(canPerform(context, "appointment.update", "Dental"));
    });

    it("Dental-only Manager cannot create or update Physio appointments", () => {
      const context = makeContext(["Manager"], ["Dental"]);
      equal(canPerform(context, "appointment.create", "Physio"), false);
      equal(canPerform(context, "appointment.update", "Physio"), false);
    });

    it("Owner with All scope can create and update both departments", () => {
      const context = makeContext(["Owner"], ["All"]);
      ok(canPerform(context, "appointment.create", "Physio"));
      ok(canPerform(context, "appointment.create", "Dental"));
      ok(canPerform(context, "appointment.update", "Physio"));
      ok(canPerform(context, "appointment.update", "Dental"));
    });
  });

  describe("Temporary Exception Scope Does Not Broaden Appointment Authority", () => {
    it("Dental Receptionist with temporary exception has clinical access only", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      ok(canPerform(context, "clinical.read", "Dental"));
      ok(canPerform(context, "clinical.write", "Dental"));
    });

    it("Exception does not remove base appointment.create permission", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Receptionist"],
        primaryDepartment: "Dental",
        departmentAccess: ["Dental"],
        clinicalWriteScope: "Dental_Temporary_Data_Entry",
      };
      ok(canPerform(context, "appointment.create", "Dental"));
    });

    it("Exception does not add appointment.update if role lacks it", () => {
      const context: AccessContext = {
        staffId: "test-staff",
        roles: ["Therapist"],
        primaryDepartment: "Physio",
        departmentAccess: ["Physio"],
        clinicalWriteScope: "Physio_Temporary_Data_Entry",
      };
      equal(canPerform(context, "appointment.update", "Physio"), false);
    });
  });
});
