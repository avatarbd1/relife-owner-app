import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/data/supabaseAdmin";
import { requireTenantScope, type TenantRoleCode, type TenantScope } from "@/lib/domain/tenancy/policy";

export interface StoredStaffProvisioning extends TenantScope {
  bindingId: string;
  staffId: string;
  roleCodes: TenantRoleCode[];
  departmentIds: string[];
  status: "active" | "inactive";
  isDefault: boolean;
}

function adminClient(): SupabaseClient {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new Error("STAFF_PROVISIONING_STORE_UNAVAILABLE");
  }
}

function ensure(error: { message?: string } | null, operation: string): void {
  if (error) throw new Error(`STAFF_PROVISIONING_${operation}_FAILED:${error.message || "unknown"}`);
}

export async function listStoredStaffProvisioning(
  scope: TenantScope,
  client = adminClient(),
): Promise<StoredStaffProvisioning[]> {
  const tenant = requireTenantScope(scope);
  const relife = client.schema("relife");
  const bindings = await relife.from("staff_tenant_bindings")
    .select("id,staff_id,status,is_default")
    .eq("organization_id", tenant.organizationId)
    .eq("clinic_id", tenant.clinicId);
  ensure(bindings.error, "READ");
  const rows = (bindings.data || []) as Array<{ id: string; staff_id: string; status: "active" | "inactive"; is_default: boolean }>;
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [roles, departments] = await Promise.all([
    relife.from("staff_tenant_roles").select("binding_id,role_code").in("binding_id", ids),
    relife.from("staff_tenant_departments").select("binding_id,department_id").in("binding_id", ids),
  ]);
  ensure(roles.error, "ROLES_READ"); ensure(departments.error, "DEPARTMENTS_READ");
  return rows.map((row) => ({
    ...tenant,
    bindingId: row.id,
    staffId: row.staff_id,
    roleCodes: ((roles.data || []) as Array<{ binding_id: string; role_code: TenantRoleCode }>).filter((item) => item.binding_id === row.id).map((item) => item.role_code),
    departmentIds: ((departments.data || []) as Array<{ binding_id: string; department_id: string }>).filter((item) => item.binding_id === row.id).map((item) => item.department_id),
    status: row.status,
    isDefault: row.is_default,
  }));
}

export async function replaceStoredStaffProvisioning(
  scope: TenantScope,
  input: { staffId: string; roleCodes: TenantRoleCode[]; departmentIds: string[]; status: "active" | "inactive"; isDefault?: boolean },
  client = adminClient(),
): Promise<void> {
  const tenant = requireTenantScope(scope);
  const staffId = input.staffId.trim();
  if (!staffId || input.roleCodes.length === 0 || input.departmentIds.length === 0) throw new Error("STAFF_PROVISIONING_INVALID");
  const relife = client.schema("relife");
  const binding = await relife.from("staff_tenant_bindings").upsert({
    staff_id: staffId,
    organization_id: tenant.organizationId,
    clinic_id: tenant.clinicId,
    status: input.status,
    is_default: Boolean(input.isDefault),
    updated_at: new Date().toISOString(),
  }, { onConflict: "staff_id,organization_id,clinic_id" }).select("id").single();
  ensure(binding.error, "BINDING_WRITE");
  const bindingId = String((binding.data as { id: string }).id);

  const deactivate = async () => {
    await relife.from("staff_tenant_bindings").update({ status: "inactive", is_default: false, updated_at: new Date().toISOString() }).eq("id", bindingId);
  };
  try {
    const [dropRoles, dropDepartments] = await Promise.all([
      relife.from("staff_tenant_roles").delete().eq("binding_id", bindingId),
      relife.from("staff_tenant_departments").delete().eq("binding_id", bindingId),
    ]);
    ensure(dropRoles.error, "ROLES_REPLACE"); ensure(dropDepartments.error, "DEPARTMENTS_REPLACE");
    const roleWrite = await relife.from("staff_tenant_roles").insert([...new Set(input.roleCodes)].map((role_code) => ({ binding_id: bindingId, role_code })));
    ensure(roleWrite.error, "ROLES_WRITE");
    const departmentWrite = await relife.from("staff_tenant_departments").insert([...new Set(input.departmentIds)].map((department_id) => ({ binding_id: bindingId, department_id })));
    ensure(departmentWrite.error, "DEPARTMENTS_WRITE");
  } catch (error) {
    await deactivate();
    throw error;
  }
}

export async function deactivateStoredStaffProvisioning(scope: TenantScope, staffId: string, client = adminClient()): Promise<void> {
  const tenant = requireTenantScope(scope);
  const result = await client.schema("relife").from("staff_tenant_bindings")
    .update({ status: "inactive", is_default: false, updated_at: new Date().toISOString() })
    .eq("organization_id", tenant.organizationId).eq("clinic_id", tenant.clinicId).eq("staff_id", staffId.trim())
    .select("id").maybeSingle();
  ensure(result.error, "DEACTIVATE");
  if (!result.data) throw new Error("STAFF_PROVISIONING_NOT_FOUND");
}
