import StaffAccessManager from "@/components/StaffAccessManager";
import StaffManagementClient from "@/components/StaffManagementClient";
import { requireCurrentTenantAccessContext } from "@/lib/webos/currentUser";
import { listManagedStaff } from "@/lib/webos/staffManagement";

export default async function StaffAccessPage() {
  const tenantContext = await requireCurrentTenantAccessContext();
  const context = tenantContext.access;
  if (!context.roles.includes("Owner")) {
    return (
      <div className="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
        Owner access required.
      </div>
    );
  }

  const staff = await listManagedStaff(
    context,
    tenantContext.tenant.organizationId,
    tenantContext.tenant.clinicId
  );
  const setupReady = staff
    .filter(
      (item) =>
        item.status === "Active" &&
        item.roles.length > 0 &&
        item.departmentAccess.length > 0
    )
    .map((item) => ({
      staffId: item.staffId,
      fullName: item.fullName,
      roles: item.roles,
      departments: item.departmentAccess,
    }));

  return (
    <div className="space-y-6">
      <StaffManagementClient staff={staff} />
      <StaffAccessManager staff={setupReady} />
    </div>
  );
}
