import "server-only";

import type { TenantScope } from "@/lib/domain/tenancy/policy";
import { canPerform, type AccessContext } from "@/lib/webos/access";
import type { ClinicianOption } from "@/lib/webos/reception";
import { listTenantScopedWebStaffDirectory } from "@/lib/webos/tenantStaffDirectory";

export async function getTenantClinicianOptions(
  context: AccessContext,
  tenant: TenantScope
): Promise<ClinicianOption[]> {
  const directory = await listTenantScopedWebStaffDirectory(tenant);
  return directory.flatMap((staff) => {
    if (staff.status !== "Active") return [];
    const department = staff.roles.includes("Dentist")
      ? "Dental" as const
      : staff.roles.includes("Therapist")
        ? "Physio" as const
        : null;
    if (!department || !canPerform(context, "appointment.create", department)) return [];
    return [{ staffId: staff.staffId, fullName: staff.fullName, department }];
  });
}
