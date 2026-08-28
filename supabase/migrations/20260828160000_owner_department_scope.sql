begin;

-- Owner department scope is a tenant-owned invariant. New single-type clinics
-- must not receive cross-department access merely because the control plane
-- inserts the compatibility value `All`. Mixed clinics remain `All` based on
-- their configured active services. This is forward-only: existing owner rows
-- are not rewritten, preserving legacy operational access until explicitly
-- re-provisioned.
create or replace function relife.owner_department_scope_for_binding(p_binding_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = relife, pg_catalog
as $$
declare
  v_clinic_type text;
  v_departments text[];
begin
  select s.clinic_type
  into v_clinic_type
  from relife.staff_tenant_bindings b
  left join relife.clinic_settings s
    on s.organization_id = b.organization_id
   and s.clinic_id = b.clinic_id
  where b.id = p_binding_id;

  if not found then
    return 'All';
  end if;

  select array_agg(distinct sv.department order by sv.department)
  into v_departments
  from relife.staff_tenant_bindings b
  join relife.clinic_services sv
    on sv.organization_id = b.organization_id
   and sv.clinic_id = b.clinic_id
  where b.id = p_binding_id
    and sv.is_active = true
    and sv.department in ('Physio', 'Dental');

  if coalesce(array_length(v_departments, 1), 0) > 1 then
    return 'All';
  end if;

  if coalesce(array_length(v_departments, 1), 0) = 1 then
    return v_departments[1];
  end if;

  if v_clinic_type = 'physiotherapy' then
    return 'Physio';
  end if;
  if v_clinic_type = 'dental' then
    return 'Dental';
  end if;
  return 'All';
end;
$$;

revoke all on function relife.owner_department_scope_for_binding(uuid) from public, anon, authenticated;
grant execute on function relife.owner_department_scope_for_binding(uuid) to service_role;

create or replace function relife.enforce_owner_department_scope()
returns trigger
language plpgsql
security definer
set search_path = relife, pg_catalog
as $$
begin
  if exists (
    select 1
    from relife.staff_tenant_roles r
    where r.binding_id = new.binding_id
      and r.role_code = 'owner'
  ) then
    new.department_id := relife.owner_department_scope_for_binding(new.binding_id);
  end if;
  return new;
end;
$$;

revoke all on function relife.enforce_owner_department_scope() from public, anon, authenticated;

drop trigger if exists staff_tenant_departments_owner_scope on relife.staff_tenant_departments;
create trigger staff_tenant_departments_owner_scope
before insert or update of department_id
on relife.staff_tenant_departments
for each row
execute function relife.enforce_owner_department_scope();

commit;
