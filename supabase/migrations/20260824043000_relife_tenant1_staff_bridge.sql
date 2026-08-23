-- Relife Tenant #1 bridge for the existing staff-session identity model.
--
-- Current Web/PWA sessions carry a stable staff ID (for Owner, ST001) rather
-- than a Supabase Auth user ID. Do not create fake auth.users rows or replace
-- the current login flow during the tenant cutover. This table is the narrow
-- bridge from the existing staff identity to the canonical Tenant/Clinic.

create table if not exists relife.staff_tenant_bindings (
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  auth_user_id uuid null references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, staff_id),
  constraint staff_tenant_bindings_staff_id_check
    check (staff_id ~ '^[A-Za-z0-9_-]{2,64}$'),
  constraint staff_tenant_bindings_tenant_fk
    foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id)
    on delete restrict
);

create unique index if not exists staff_tenant_bindings_one_active_default_idx
  on relife.staff_tenant_bindings (staff_id)
  where status = 'active' and is_default = true;

create index if not exists staff_tenant_bindings_auth_user_idx
  on relife.staff_tenant_bindings (auth_user_id)
  where auth_user_id is not null and status = 'active';

create index if not exists staff_tenant_bindings_tenant_staff_idx
  on relife.staff_tenant_bindings (organization_id, clinic_id, staff_id)
  where status = 'active';

alter table relife.staff_tenant_bindings enable row level security;
revoke all on table relife.staff_tenant_bindings from public, anon, authenticated;

comment on table relife.staff_tenant_bindings is
  'Bridge from legacy Web/PWA staff-session identity to canonical organization/clinic tenant scope. auth_user_id is nullable for a future Supabase Auth convergence; staff_id remains the current login identity during cutover.';
comment on column relife.staff_tenant_bindings.is_default is
  'Exactly one active default tenant binding is required for a staff session that does not yet carry an explicit clinic selection.';

-- Relife is Tenant #1. Bind the existing Owner session identity without
-- hard-coding generated UUIDs. This does not create a second clinic or user.
insert into relife.staff_tenant_bindings (
  organization_id,
  clinic_id,
  staff_id,
  status,
  is_default
)
select
  o.id,
  c.id,
  'ST001',
  'active',
  true
from relife.organizations o
join relife.clinics c on c.organization_id = o.id
where o.slug = 'relife'
  and o.status = 'active'
  and c.slug = 'amtali-main'
  and c.status = 'active'
on conflict (organization_id, clinic_id, staff_id) do update
set status = 'active',
    is_default = true,
    updated_at = now();

-- Fail the migration rather than silently leaving Owner without a tenant.
do $$
begin
  if not exists (
    select 1
    from relife.staff_tenant_bindings b
    join relife.organizations o on o.id = b.organization_id
    join relife.clinics c
      on c.id = b.clinic_id
     and c.organization_id = b.organization_id
    where b.staff_id = 'ST001'
      and b.status = 'active'
      and b.is_default = true
      and o.slug = 'relife'
      and c.slug = 'amtali-main'
  ) then
    raise exception 'RELIFE_TENANT1_OWNER_BINDING_FAILED';
  end if;
end
$$;
