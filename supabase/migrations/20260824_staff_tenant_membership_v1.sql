begin;

create table if not exists relife.staff_tenant_bindings (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,
  organization_id uuid not null references relife.organizations(id) on delete cascade,
  clinic_id uuid not null references relife.clinics(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, organization_id, clinic_id)
);

create unique index if not exists staff_tenant_bindings_one_default_per_org
  on relife.staff_tenant_bindings (staff_id, organization_id)
  where is_default and status = 'active';

create index if not exists staff_tenant_bindings_scope_idx
  on relife.staff_tenant_bindings (organization_id, clinic_id, staff_id, status);

create table if not exists relife.staff_tenant_roles (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references relife.staff_tenant_bindings(id) on delete cascade,
  role_code text not null check (btrim(role_code) <> ''),
  created_at timestamptz not null default now(),
  unique (binding_id, role_code)
);

create table if not exists relife.staff_tenant_departments (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references relife.staff_tenant_bindings(id) on delete cascade,
  department_id text not null check (btrim(department_id) <> ''),
  created_at timestamptz not null default now(),
  unique (binding_id, department_id)
);

create or replace function relife.enforce_staff_binding_clinic_organization()
returns trigger
language plpgsql
set search_path = relife, public
as $$
declare
  clinic_organization_id uuid;
begin
  select c.organization_id
    into clinic_organization_id
    from relife.clinics c
   where c.id = new.clinic_id;

  if clinic_organization_id is null then
    raise exception 'STAFF_BINDING_CLINIC_NOT_FOUND';
  end if;

  if clinic_organization_id <> new.organization_id then
    raise exception 'STAFF_BINDING_CLINIC_ORGANIZATION_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_binding_clinic_organization on relife.staff_tenant_bindings;
create trigger trg_staff_binding_clinic_organization
before insert or update of organization_id, clinic_id
on relife.staff_tenant_bindings
for each row execute function relife.enforce_staff_binding_clinic_organization();

alter table relife.staff_tenant_bindings enable row level security;
alter table relife.staff_tenant_roles enable row level security;
alter table relife.staff_tenant_departments enable row level security;

-- Baseline is deliberately deny-all for browser roles. Access is through the
-- trusted server/service-role path until a later, explicitly reviewed RLS slice.
drop policy if exists staff_tenant_bindings_deny_anon on relife.staff_tenant_bindings;
create policy staff_tenant_bindings_deny_anon on relife.staff_tenant_bindings
  for all to anon using (false) with check (false);
drop policy if exists staff_tenant_bindings_deny_authenticated on relife.staff_tenant_bindings;
create policy staff_tenant_bindings_deny_authenticated on relife.staff_tenant_bindings
  for all to authenticated using (false) with check (false);

drop policy if exists staff_tenant_roles_deny_anon on relife.staff_tenant_roles;
create policy staff_tenant_roles_deny_anon on relife.staff_tenant_roles
  for all to anon using (false) with check (false);
drop policy if exists staff_tenant_roles_deny_authenticated on relife.staff_tenant_roles;
create policy staff_tenant_roles_deny_authenticated on relife.staff_tenant_roles
  for all to authenticated using (false) with check (false);

drop policy if exists staff_tenant_departments_deny_anon on relife.staff_tenant_departments;
create policy staff_tenant_departments_deny_anon on relife.staff_tenant_departments
  for all to anon using (false) with check (false);
drop policy if exists staff_tenant_departments_deny_authenticated on relife.staff_tenant_departments;
create policy staff_tenant_departments_deny_authenticated on relife.staff_tenant_departments
  for all to authenticated using (false) with check (false);

grant usage on schema relife to service_role;
grant select, insert, update, delete on relife.staff_tenant_bindings to service_role;
grant select, insert, update, delete on relife.staff_tenant_roles to service_role;
grant select, insert, update, delete on relife.staff_tenant_departments to service_role;

commit;
