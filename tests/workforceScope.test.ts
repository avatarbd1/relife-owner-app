import test from "node:test";
import assert from "node:assert/strict";
import type { AccessContext, WebRole } from "../lib/webos/access.ts";
import {
  canReachLeaveRow,
  canReachShiftRow,
  visibleLeave,
  visibleShifts,
} from "../lib/domain/workforce/workforceScope.ts";
import type { LeaveRecord, ShiftRecord } from "../lib/domain/workforce/types.ts";

function context(
  staffId: string,
  roles: WebRole[],
  departmentAccess: AccessContext["departmentAccess"],
  primaryDepartment: AccessContext["primaryDepartment"]
): AccessContext {
  return { staffId, roles, departmentAccess, primaryDepartment };
}

function shift(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    shiftId: "SHF1",
    staffId: "S1",
    staffName: "Staff One",
    department: "Physio",
    shiftDate: "2026-08-22",
    startTime: "09:00",
    endTime: "13:00",
    status: "Published",
    notes: "private note",
    requestId: "req_00000001",
    createdBy: "OWNER1",
    createdAt: "2026-08-20 10:00",
    updatedBy: "OWNER1",
    updatedAt: "2026-08-20 10:00",
    ...overrides,
  };
}

function leave(overrides: Partial<LeaveRecord> = {}): LeaveRecord {
  return {
    leaveId: "LVE1",
    staffId: "S1",
    staffName: "Staff One",
    department: "Physio",
    leaveType: "Casual",
    startDate: "2026-08-22",
    endDate: "2026-08-23",
    reason: "private reason",
    status: "Pending",
    requestId: "req_00000001",
    requestedAt: "2026-08-20 10:00",
    decidedBy: "",
    decidedAt: "",
    decisionNote: "",
    updatedBy: "S1",
    updatedAt: "2026-08-20 10:00",
    ...overrides,
  };
}

// --- Scenario: Owner full access ---
test("Owner sees every shift (including Draft) and every leave with full text, across departments", () => {
  const owner = context("OWNER1", ["Owner"], ["All"], "All");
  const shifts = [
    shift({ shiftId: "S-draft", status: "Draft" }),
    shift({ shiftId: "S-dental", department: "Dental" }),
  ];
  assert.equal(visibleShifts(owner, shifts).length, 2);
  const leaves = [leave({ department: "Dental" })];
  const visible = visibleLeave(owner, leaves);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].reason, "private reason", "Owner receives full Reason text");
});

// --- Scenario: Manager department scope ---
test("Manager sees Draft+Published shifts and full leave detail only within their own department", () => {
  const physioManager = context("MGR1", ["Manager"], ["Physio"], "Physio");
  const shifts = [
    shift({ shiftId: "S-physio-draft", department: "Physio", status: "Draft" }),
    shift({ shiftId: "S-dental", department: "Dental" }),
  ];
  const visible = visibleShifts(physioManager, shifts);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].shiftId, "S-physio-draft", "Dental row is out of the Manager's department scope");

  const leaves = [leave({ department: "Physio" }), leave({ leaveId: "LVE-dental", department: "Dental" })];
  const visibleL = visibleLeave(physioManager, leaves);
  assert.equal(visibleL.length, 1);
  assert.equal(visibleL[0].reason, "private reason");
});

// --- Scenario: Receptionist/Therapist/Dentist own-only scope ---
for (const role of ["Receptionist", "Therapist", "Dentist"] as WebRole[]) {
  test(`${role} sees only their own Published shifts and only their own leave (any status)`, () => {
    const staff = context("S1", [role], ["Physio"], "Physio");
    const shifts = [
      shift({ shiftId: "S-own-published", staffId: "S1", status: "Published" }),
      shift({ shiftId: "S-own-draft", staffId: "S1", status: "Draft" }),
      shift({ shiftId: "S-other-published", staffId: "S2", status: "Published" }),
    ];
    const visible = visibleShifts(staff, shifts);
    assert.deepEqual(
      visible.map((row) => row.shiftId),
      ["S-own-published"],
      "own Draft and any other staff's shift must both be excluded"
    );

    const leaves = [
      leave({ leaveId: "LVE-own", staffId: "S1", status: "Approved" }),
      leave({ leaveId: "LVE-other", staffId: "S2" }),
    ];
    const visibleL = visibleLeave(staff, leaves);
    assert.deepEqual(visibleL.map((row) => row.leaveId), ["LVE-own"]);
    assert.equal(visibleL[0].reason, "private reason", "staff sees their own Reason text");
  });
}

// --- Scenario: Auditor redaction + coverage-only, never a decision/mutation target ---
test("Auditor sees Published-only shift coverage with Notes redacted, and leave status/date summaries with Reason/Decision_Note redacted", () => {
  const auditor = context("AUD1", ["Auditor"], ["All"], "All");
  const shifts = [
    shift({ shiftId: "S-published", status: "Published" }),
    shift({ shiftId: "S-draft", status: "Draft" }),
  ];
  const visible = visibleShifts(auditor, shifts);
  assert.deepEqual(visible.map((row) => row.shiftId), ["S-published"], "Draft is never coverage");
  assert.equal(visible[0].notes, "", "Auditor never receives free-text Notes");
  assert.equal(visible[0].requestId, "", "Auditor never receives request markers");
  assert.equal(visible[0].createdBy, "", "Auditor never receives writer metadata");

  const leaves = [leave({ decisionNote: "confidential note" })];
  const visibleL = visibleLeave(auditor, leaves);
  assert.equal(visibleL.length, 1);
  assert.equal(visibleL[0].reason, "", "Auditor never receives Reason");
  assert.equal(visibleL[0].decisionNote, "", "Auditor never receives Decision_Note");
  assert.equal(visibleL[0].requestId, "", "Auditor never receives request markers");
  assert.equal(visibleL[0].decidedBy, "", "Auditor never receives decision actor metadata");
  assert.equal(visibleL[0].status, "Pending", "status itself is still visible as a summary field");
});

// --- Scenario: Dental Assistant / System Admin denial ---
for (const role of ["Dental_Assistant", "System Admin"] as WebRole[]) {
  test(`${role} has no workforce access at all (no shift.read/leave.read granted)`, () => {
    const staff = context("DA1", [role], ["Dental"], "Dental");
    assert.deepEqual(visibleShifts(staff, [shift({ department: "Dental", status: "Published" })]), []);
    assert.deepEqual(visibleLeave(staff, [leave({ department: "Dental" })]), []);
  });
}

// --- Scenario: direct-ID cross-staff / cross-department denial ---
test("direct-ID reach: cross-department Manager cannot reach a row outside their scope, even by exact ID", () => {
  const dentalManager = context("MGR2", ["Manager"], ["Dental"], "Dental");
  assert.equal(canReachShiftRow(dentalManager, shift({ department: "Physio" })), false);
  assert.equal(canReachLeaveRow(dentalManager, leave({ department: "Physio" })), false);
});

test("direct-ID reach: staff cannot reach another staff member's row by exact ID, even same department", () => {
  const staff = context("S1", ["Receptionist"], ["Physio"], "Physio");
  assert.equal(canReachShiftRow(staff, shift({ staffId: "S2", status: "Published" })), false);
  assert.equal(canReachLeaveRow(staff, leave({ staffId: "S2" })), false);
  assert.equal(canReachShiftRow(staff, shift({ staffId: "S1", status: "Published" })), true);
  assert.equal(canReachLeaveRow(staff, leave({ staffId: "S1" })), true);
});

test("direct-ID reach: staff cannot reach their own Draft shift by exact ID (only Published is theirs to see)", () => {
  const staff = context("S1", ["Therapist"], ["Physio"], "Physio");
  assert.equal(canReachShiftRow(staff, shift({ staffId: "S1", status: "Draft" })), false);
});

test("direct-ID reach: Auditor can reach a Published shift but not a Draft one, and can reach any leave summary", () => {
  const auditor = context("AUD1", ["Auditor"], ["All"], "All");
  assert.equal(canReachShiftRow(auditor, shift({ status: "Published" })), true);
  assert.equal(canReachShiftRow(auditor, shift({ status: "Draft" })), false);
  assert.equal(canReachLeaveRow(auditor, leave()), true);
});
