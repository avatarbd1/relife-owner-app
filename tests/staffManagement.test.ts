import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { readFileSync } from "node:fs";

const domain = readFileSync(
  new URL("../lib/webos/staffManagement.ts", import.meta.url),
  "utf8"
);
const collectionRoute = readFileSync(
  new URL("../app/api/staff/route.ts", import.meta.url),
  "utf8"
);
const itemRoute = readFileSync(
  new URL("../app/api/staff/[staffId]/route.ts", import.meta.url),
  "utf8"
);
const deactivateRoute = readFileSync(
  new URL("../app/api/staff/[staffId]/deactivate/route.ts", import.meta.url),
  "utf8"
);
const page = readFileSync(
  new URL("../app/(dashboard)/security/staff-access/page.tsx", import.meta.url),
  "utf8"
);
const managementUi = readFileSync(
  new URL("../components/StaffManagementClient.tsx", import.meta.url),
  "utf8"
);
const enrollmentRoute = readFileSync(
  new URL("../app/api/staff/enrollment-link/route.ts", import.meta.url),
  "utf8"
);

describe("full staff management", () => {
  it("exposes the canonical owner staff CRUD-style API without hard delete", () => {
    ok(collectionRoute.includes("export async function GET"));
    ok(collectionRoute.includes("export async function POST"));
    ok(itemRoute.includes("export async function PATCH"));
    ok(deactivateRoute.includes("export async function POST"));
    equal(domain.includes("deleteSheet"), false);
    equal(domain.includes("deleteDimension"), false);
  });

  it("keeps writes owner-authorized and same-origin protected", () => {
    ok(domain.includes('context.roles.includes("Owner")'));
    ok(collectionRoute.includes("isAllowedRequestOrigin(request)"));
    ok(itemRoute.includes("isAllowedRequestOrigin(request)"));
    ok(deactivateRoute.includes("isAllowedRequestOrigin(request)"));
  });

  it("uses distributed mutation locks and one Sheets batch for staff, access mapping and audit", () => {
    ok(domain.includes('withMutationLock("staff-management:create"'));
    ok(domain.includes("withMutationLock(`staff-management:${staffId}`"));
    ok(domain.includes('requireSheetId(snapshot.ids, "08_Staff")'));
    ok(domain.includes('requireSheetId(snapshot.ids, "Staff_Department_Access")'));
    ok(domain.includes('requireSheetId(snapshot.ids, "20_Data_Audit")'));
    ok(domain.includes('"staff.create"'));
    ok(domain.includes('"staff.update"'));
    ok(domain.includes('"staff.deactivate"'));
    ok(domain.includes('await batchUpdateSpreadsheet("physio", requests)'));
  });

  it("prevents owner privilege creation and constrains clinical department roles", () => {
    equal(domain.includes('"Owner",\n  "Manager"'), false);
    ok(domain.includes('role === "Therapist"'));
    ok(domain.includes('role === "Dentist" || role === "Dental_Assistant"'));
    ok(domain.includes('"Dental_Temporary_Data_Entry"'));
    ok(domain.includes('throw new Error("OWNER_PROFILE_IMMUTABLE")'));
  });

  it("keeps deactivation soft and preserves enrollment as a separate passkey workflow", () => {
    ok(domain.includes('updateCellRequest(staffSheetId, rowNumber, snapshot.statusIdx + 1, "Inactive")'));
    ok(domain.includes("deactivateExistingAccessRequests"));
    ok(domain.includes('updateCellRequest(accessSheetId, index + 2, snapshot.accessStatusIdx + 1, "Inactive")'));
    ok(enrollmentRoute.includes("createStaffEnrollmentToken"));
    ok(enrollmentRoute.includes("listPasskeysForStaff"));
  });

  it("keeps fixed salary on 08_Staff and does not create a salary-ledger writer", () => {
    ok(domain.includes('headerIndex(staffHeaders, "Salary")'));
    ok(domain.includes("set(snapshot.salaryIdx, normalizedInput.salary)"));
    equal(domain.includes('"13_Salary"'), false);
    equal(domain.includes("paySalary("), false);
  });

  it("wires the owner screen to management plus existing device enrollment", () => {
    ok(page.includes("<StaffManagementClient staff={staff} />"));
    ok(page.includes("<StaffAccessManager staff={setupReady} />"));
    ok(managementUi.includes('fetch(endpoint'));
    ok(managementUi.includes('/api/staff/${encodeURIComponent(item.staffId)}/deactivate'));
    ok(managementUi.includes("router.refresh()"));
  });
});
