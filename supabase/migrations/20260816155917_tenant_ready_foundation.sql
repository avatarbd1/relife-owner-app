create table if not exists relife.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists relife.clinics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references relife.organizations(id) on delete restrict,
  slug text not null,
  name text not null,
  timezone text not null default 'Asia/Dhaka',
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id)
);

create table if not exists relife.clinic_memberships (
  clinic_id uuid not null references relife.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

insert into relife.organizations (slug, name)
values ('relife', 'Relife')
on conflict (slug) do update set name = excluded.name, updated_at = now();

insert into relife.clinics (organization_id, slug, name, timezone)
select id, 'amtali-main', 'Relife Amtali', 'Asia/Dhaka'
from relife.organizations
where slug = 'relife'
on conflict (organization_id, slug) do update
set name = excluded.name, timezone = excluded.timezone, updated_at = now();

create or replace function relife.default_organization_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from relife.organizations where slug = 'relife' limit 1
$$;

create or replace function relife.default_clinic_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
  from relife.clinics c
  join relife.organizations o on o.id = c.organization_id
  where o.slug = 'relife' and c.slug = 'amtali-main'
  limit 1
$$;

do $$
declare
  t text;
  tenant_tables text[] := array[
    'appointments',
    'booking_conflicts',
    'chamber_resources',
    'chamber_sessions',
    'chat_messages',
    'equipment_requests',
    'machine_reservations',
    'patient_cache',
    'treatment_plan_cache',
    'treatment_timeline'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table relife.%I add column if not exists organization_id uuid', t);
    execute format('alter table relife.%I add column if not exists clinic_id uuid', t);
    execute format('update relife.%I set organization_id = relife.default_organization_id() where organization_id is null', t);
    execute format('update relife.%I set clinic_id = relife.default_clinic_id() where clinic_id is null', t);
    execute format('alter table relife.%I alter column organization_id set default relife.default_organization_id()', t);
    execute format('alter table relife.%I alter column clinic_id set default relife.default_clinic_id()', t);
    execute format('alter table relife.%I alter column organization_id set not null', t);
    execute format('alter table relife.%I alter column clinic_id set not null', t);
    execute format('alter table relife.%I enable row level security', t);
    execute format('create index if not exists %I on relife.%I (clinic_id)', t || '_clinic_idx', t);

    if not exists (
      select 1 from pg_constraint
      where conname = t || '_tenant_fk'
        and conrelid = format('relife.%I', t)::regclass
    ) then
      execute format(
        'alter table relife.%I add constraint %I foreign key (organization_id, clinic_id) references relife.clinics (organization_id, id) on delete restrict',
        t,
        t || '_tenant_fk'
      );
    end if;
  end loop;
end
$$;

create index if not exists clinic_memberships_user_idx
  on relife.clinic_memberships (user_id, clinic_id)
  where status = 'active';

create index if not exists appointments_clinic_date_idx
  on relife.appointments (clinic_id, date, start_time);
create index if not exists chamber_sessions_clinic_date_idx
  on relife.chamber_sessions (clinic_id, date, status);
create index if not exists machine_reservations_clinic_date_idx
  on relife.machine_reservations (clinic_id, date, resource_id, start_minute);
create index if not exists treatment_timeline_clinic_date_idx
  on relife.treatment_timeline (clinic_id, date, start_minute);
create index if not exists patient_cache_clinic_patient_idx
  on relife.patient_cache (clinic_id, patient_id);
create index if not exists treatment_plan_cache_clinic_patient_idx
  on relife.treatment_plan_cache (clinic_id, patient_id);
create index if not exists chamber_resources_clinic_resource_idx
  on relife.chamber_resources (clinic_id, resource_id);

alter table relife.organizations enable row level security;
alter table relife.clinics enable row level security;
alter table relife.clinic_memberships enable row level security;

revoke all on table relife.organizations from anon, authenticated;
revoke all on table relife.clinics from anon, authenticated;
revoke all on table relife.clinic_memberships from anon, authenticated;

comment on table relife.clinic_memberships is 'Tenant membership foundation. Client/API grants and membership RLS policies remain intentionally disabled until Supabase Auth cutover.';
comment on column relife.appointments.clinic_id is 'Tenant clinic scope. Defaults to amtali-main only during single-clinic compatibility mode; future tenant-aware writes must provide clinic_id explicitly.';
