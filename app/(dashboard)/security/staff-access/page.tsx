import StaffAccessManager from "@/components/StaffAccessManager";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import { getWebStaffDirectory, toAccessContext } from "@/lib/webos/staffDirectory";

export default async function StaffAccessPage() {
  const context = await requireCurrentAccessContext();
  if (!context.roles.includes("Owner")) {
    return (
      <div className="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
        Owner access required.
      </div>
    );
  }

  const directory = await getWebStaffDirectory();
  const staff = directory
    .filter(
      (item) =>
        item.status === "Active" &&
        !item.roles.includes("Owner") &&
        Boolean(toAccessContext(item))
    )
    .map((item) => ({
      staffId: item.staffId,
      fullName: item.fullName,
      roles: item.roles,
      departments: item.departmentAccess,
    }));

  return <StaffAccessManager staff={staff} />;
}
