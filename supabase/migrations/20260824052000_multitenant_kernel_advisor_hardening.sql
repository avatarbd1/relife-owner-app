-- Supabase advisor hardening for Multi-Tenant Kernel V1.
-- No authority or business-rule change: optimize RLS auth lookup initialization
-- and add covering indexes for new foreign keys introduced by the kernel.

create index if not exists membership_departments_department_fk_idx
  on relife.membership_departments (organization_id, clinic_id, department_id);

create index if not exists membership_roles_role_code_idx
  on relife.membership_roles (role_code);

create index if not exists role_permissions_permission_code_idx
  on relife.role_permissions (permission_code);

create index if not exists outcome_facts_subject_fk_idx
  on relife_analytics.outcome_facts (organization_id, clinic_id, subject_key);

drop policy if exists tenant_member_read_organization on relife.organizations;
create policy tenant_member_read_organization
on relife.organizations
for select
to authenticated
using (
  exists (
    select 1
    from relife.clinic_memberships m
    where m.organization_id = organizations.id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);

drop policy if exists tenant_member_read_self_membership on relife.clinic_memberships;
create policy tenant_member_read_self_membership
on relife.clinic_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or relife.user_has_permission(organization_id, clinic_id, 'membership.read')
);

drop policy if exists tenant_member_read_roles on relife.membership_roles;
create policy tenant_member_read_roles
on relife.membership_roles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or relife.user_has_permission(organization_id, clinic_id, 'membership.read')
);

drop policy if exists tenant_member_read_departments on relife.membership_departments;
create policy tenant_member_read_departments
on relife.membership_departments
for select
to authenticated
using (
  user_id = (select auth.uid())
  or relife.user_has_permission(organization_id, clinic_id, 'membership.read')
);

drop policy if exists authenticated_read_role_catalog on relife.roles;
create policy authenticated_read_role_catalog
on relife.roles
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists authenticated_read_permission_catalog on relife.permissions;
create policy authenticated_read_permission_catalog
on relife.permissions
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists authenticated_read_role_permissions on relife.role_permissions;
create policy authenticated_read_role_permissions
on relife.role_permissions
for select
to authenticated
using ((select auth.uid()) is not null);
