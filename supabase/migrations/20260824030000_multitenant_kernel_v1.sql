-- Multi-tenant kernel v1
-- Canonical model: relife.organizations = Tenant; relife.clinics = branch/chamber container.
-- This migration is additive. Existing single-clinic defaults remain compatibility-only
-- until every operational writer passes explicit organization_id + clinic_id.

-- ---------------------------------------------------------------------------
-- 1. Membership identity: preserve legacy role text, add canonical tenant key.
-- ---------------------------------------------------------------------------

alter table relife.clinic_memberships
  add column if not exists organization_id uuid;

update relife.clinic_memberships m
set organization_id = c.organization_id
from relife.clinics c
where c.id = m.clinic_id
  and m.organization_id is null;

alter table relife.clinic_memberships
  alter column organization_id set not null;

create unique index if not exists clinic_memberships_tenant_user_uidx
  on relife.clinic_memberships (organization_id, clinic_id, user_id);

create index if not exists clinic_memberships_org_user_idx
  on relife.clinic_memberships (organization_id, user_id, clinic_id)
  where status = 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinic_memberships_tenant_fk'
      and conrelid = 'relife.clinic_memberships'::regclass
  ) then
    alter table relife.clinic_memberships
      add constraint clinic_memberships_tenant_fk
      foreign key (organization_id, clinic_id)
      references relife.clinics (organization_id, id)
      on delete cascade;
  end if;
end
$$;

comment on table relife.organizations is
  'Canonical SaaS tenant record. One organization may own one or more clinics.';
comment on table relife.clinics is
  'Tenant-scoped clinic/branch record. Operational rows must retain organization_id + clinic_id.';
comment on column relife.clinic_memberships.role is
  'Legacy primary-role compatibility field. relife.membership_roles is authoritative for multi-role access after cutover.';

-- ---------------------------------------------------------------------------
-- 2. Departments, roles, permissions, and multi-role/multi-department mapping.
-- ---------------------------------------------------------------------------

create table if not exists relife.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, clinic_id, code),
  unique (organization_id, clinic_id, id),
  foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id)
    on delete cascade
);

insert into relife.departments (organization_id, clinic_id, code, name)
select organization_id, id, 'physio', 'Physiotherapy'
from relife.clinics
on conflict (organization_id, clinic_id, code) do nothing;

insert into relife.departments (organization_id, clinic_id, code, name)
select organization_id, id, 'dental', 'Dental'
from relife.clinics
on conflict (organization_id, clinic_id, code) do nothing;

create table if not exists relife.roles (
  code text primary key,
  name text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

insert into relife.roles (code, name) values
  ('owner', 'Owner'),
  ('manager', 'Manager'),
  ('receptionist', 'Receptionist'),
  ('therapist', 'Therapist'),
  ('dentist', 'Dentist'),
  ('dental_assistant', 'Dental Assistant'),
  ('auditor', 'Auditor'),
  ('system_admin', 'System Admin')
on conflict (code) do update set name = excluded.name;

create table if not exists relife.permissions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

insert into relife.permissions (code, description) values
  ('tenant.read', 'Read tenant identity and status'),
  ('tenant.manage', 'Manage tenant settings'),
  ('clinic.read', 'Read clinic identity and status'),
  ('clinic.manage', 'Manage clinic settings'),
  ('membership.read', 'Read clinic membership metadata'),
  ('membership.manage', 'Manage clinic memberships and access mappings'),
  ('department.read', 'Read department identity and status'),
  ('department.manage', 'Manage department settings'),
  ('audit.read', 'Read authorized audit metadata'),
  ('analytics.aggregate.read', 'Read approved aggregate analytics'),
  ('analytics.export', 'Export an approved analytics dataset')
on conflict (code) do update set description = excluded.description;

create table if not exists relife.role_permissions (
  role_code text not null references relife.roles(code) on delete cascade,
  permission_code text not null references relife.permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_code, permission_code)
);

-- Owner gets every kernel permission.
insert into relife.role_permissions (role_code, permission_code)
select 'owner', code from relife.permissions
on conflict do nothing;

-- Manager gets operational tenant metadata, not owner-only export/tenant mutation.
insert into relife.role_permissions (role_code, permission_code) values
  ('manager', 'tenant.read'),
  ('manager', 'clinic.read'),
  ('manager', 'membership.read'),
  ('manager', 'department.read'),
  ('manager', 'department.manage'),
  ('manager', 'audit.read')
on conflict do nothing;

-- Front-line clinical roles only receive the metadata needed to resolve their scope.
insert into relife.role_permissions (role_code, permission_code) values
  ('receptionist', 'clinic.read'),
  ('receptionist', 'department.read'),
  ('therapist', 'clinic.read'),
  ('therapist', 'department.read'),
  ('dentist', 'clinic.read'),
  ('dentist', 'department.read'),
  ('dental_assistant', 'clinic.read'),
  ('dental_assistant', 'department.read'),
  ('auditor', 'tenant.read'),
  ('auditor', 'clinic.read'),
  ('auditor', 'department.read'),
  ('auditor', 'audit.read'),
  ('auditor', 'analytics.aggregate.read'),
  ('system_admin', 'tenant.read'),
  ('system_admin', 'clinic.read'),
  ('system_admin', 'membership.read'),
  ('system_admin', 'department.read')
on conflict do nothing;

create table if not exists relife.membership_roles (
  organization_id uuid not null,
  clinic_id uuid not null,
  user_id uuid not null,
  role_code text not null references relife.roles(code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, user_id, role_code),
  foreign key (organization_id, clinic_id, user_id)
    references relife.clinic_memberships (organization_id, clinic_id, user_id)
    on delete cascade
);

create table if not exists relife.membership_departments (
  organization_id uuid not null,
  clinic_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, user_id, department_id),
  foreign key (organization_id, clinic_id, user_id)
    references relife.clinic_memberships (organization_id, clinic_id, user_id)
    on delete cascade,
  foreign key (organization_id, clinic_id, department_id)
    references relife.departments (organization_id, clinic_id, id)
    on delete cascade
);

-- Backfill the legacy single role into the authoritative mapping where possible.
insert into relife.membership_roles (organization_id, clinic_id, user_id, role_code)
select
  m.organization_id,
  m.clinic_id,
  m.user_id,
  case lower(trim(m.role))
    when 'owner' then 'owner'
    when 'manager' then 'manager'
    when 'receptionist' then 'receptionist'
    when 'therapist' then 'therapist'
    when 'dentist' then 'dentist'
    when 'dental_assistant' then 'dental_assistant'
    when 'dental assistant' then 'dental_assistant'
    when 'auditor' then 'auditor'
    when 'system admin' then 'system_admin'
    when 'system_admin' then 'system_admin'
    else null
  end
from relife.clinic_memberships m
where m.role is not null
  and exists (
    select 1 from relife.roles r
    where r.code = case lower(trim(m.role))
      when 'owner' then 'owner'
      when 'manager' then 'manager'
      when 'receptionist' then 'receptionist'
      when 'therapist' then 'therapist'
      when 'dentist' then 'dentist'
      when 'dental_assistant' then 'dental_assistant'
      when 'dental assistant' then 'dental_assistant'
      when 'auditor' then 'auditor'
      when 'system admin' then 'system_admin'
      when 'system_admin' then 'system_admin'
      else null
    end
  )
on conflict do nothing;

create index if not exists membership_roles_user_idx
  on relife.membership_roles (user_id, organization_id, clinic_id);
create index if not exists membership_departments_user_idx
  on relife.membership_departments (user_id, organization_id, clinic_id);
create index if not exists departments_clinic_code_idx
  on relife.departments (clinic_id, code)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Fail-closed tenant authorization helpers for Supabase Auth cutover.
-- SECURITY DEFINER helpers intentionally return false when auth.uid() is absent.
-- ---------------------------------------------------------------------------

create or replace function relife.user_is_active_member(
  target_organization_id uuid,
  target_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from relife.clinic_memberships m
    where m.organization_id = target_organization_id
      and m.clinic_id = target_clinic_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function relife.user_has_role(
  target_organization_id uuid,
  target_clinic_id uuid,
  target_role_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select relife.user_is_active_member(target_organization_id, target_clinic_id)
    and exists (
      select 1
      from relife.membership_roles mr
      where mr.organization_id = target_organization_id
        and mr.clinic_id = target_clinic_id
        and mr.user_id = auth.uid()
        and mr.role_code = target_role_code
    )
$$;

create or replace function relife.user_has_permission(
  target_organization_id uuid,
  target_clinic_id uuid,
  target_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select relife.user_is_active_member(target_organization_id, target_clinic_id)
    and exists (
      select 1
      from relife.membership_roles mr
      join relife.role_permissions rp on rp.role_code = mr.role_code
      where mr.organization_id = target_organization_id
        and mr.clinic_id = target_clinic_id
        and mr.user_id = auth.uid()
        and rp.permission_code = target_permission_code
    )
$$;

create or replace function relife.user_has_department(
  target_organization_id uuid,
  target_clinic_id uuid,
  target_department_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select relife.user_is_active_member(target_organization_id, target_clinic_id)
    and (
      relife.user_has_role(target_organization_id, target_clinic_id, 'owner')
      or exists (
        select 1
        from relife.membership_departments md
        join relife.departments d
          on d.organization_id = md.organization_id
         and d.clinic_id = md.clinic_id
         and d.id = md.department_id
        where md.organization_id = target_organization_id
          and md.clinic_id = target_clinic_id
          and md.user_id = auth.uid()
          and d.code = target_department_code
          and d.status = 'active'
      )
    )
$$;

revoke all on function relife.user_is_active_member(uuid, uuid) from public;
revoke all on function relife.user_has_role(uuid, uuid, text) from public;
revoke all on function relife.user_has_permission(uuid, uuid, text) from public;
revoke all on function relife.user_has_department(uuid, uuid, text) from public;
grant execute on function relife.user_is_active_member(uuid, uuid) to authenticated;
grant execute on function relife.user_has_role(uuid, uuid, text) to authenticated;
grant execute on function relife.user_has_permission(uuid, uuid, text) to authenticated;
grant execute on function relife.user_has_department(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Metadata RLS. Direct client writes remain disabled; onboarding stays server-side.
-- ---------------------------------------------------------------------------

alter table relife.organizations enable row level security;
alter table relife.clinics enable row level security;
alter table relife.clinic_memberships enable row level security;
alter table relife.departments enable row level security;
alter table relife.roles enable row level security;
alter table relife.permissions enable row level security;
alter table relife.role_permissions enable row level security;
alter table relife.membership_roles enable row level security;
alter table relife.membership_departments enable row level security;

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
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

drop policy if exists tenant_member_read_clinic on relife.clinics;
create policy tenant_member_read_clinic
on relife.clinics
for select
to authenticated
using (relife.user_is_active_member(organization_id, id));

drop policy if exists tenant_member_read_department on relife.departments;
create policy tenant_member_read_department
on relife.departments
for select
to authenticated
using (relife.user_is_active_member(organization_id, clinic_id));

drop policy if exists tenant_member_read_self_membership on relife.clinic_memberships;
create policy tenant_member_read_self_membership
on relife.clinic_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or relife.user_has_permission(organization_id, clinic_id, 'membership.read')
);

drop policy if exists tenant_member_read_roles on relife.membership_roles;
create policy tenant_member_read_roles
on relife.membership_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or relife.user_has_permission(organization_id, clinic_id, 'membership.read')
);

drop policy if exists tenant_member_read_departments on relife.membership_departments;
create policy tenant_member_read_departments
on relife.membership_departments
for select
to authenticated
using (
  user_id = auth.uid()
  or relife.user_has_permission(organization_id, clinic_id, 'membership.read')
);

drop policy if exists authenticated_read_role_catalog on relife.roles;
create policy authenticated_read_role_catalog
on relife.roles
for select
to authenticated
using (auth.uid() is not null);

drop policy if exists authenticated_read_permission_catalog on relife.permissions;
create policy authenticated_read_permission_catalog
on relife.permissions
for select
to authenticated
using (auth.uid() is not null);

drop policy if exists authenticated_read_role_permissions on relife.role_permissions;
create policy authenticated_read_role_permissions
on relife.role_permissions
for select
to authenticated
using (auth.uid() is not null);

-- Metadata reads may be used after Supabase Auth cutover. No INSERT/UPDATE/DELETE
-- grant is given to authenticated; tenant onboarding remains a trusted server action.
grant usage on schema relife to authenticated;
grant select on table
  relife.organizations,
  relife.clinics,
  relife.clinic_memberships,
  relife.departments,
  relife.roles,
  relife.permissions,
  relife.role_permissions,
  relife.membership_roles,
  relife.membership_departments
to authenticated;

-- Existing operational tenant tables stay client-private. Their RLS remains enabled;
-- direct client grants/policies must be domain-specific in later cutover migrations.

-- ---------------------------------------------------------------------------
-- 5. Consent, provenance, retention, and access-audit hooks.
-- These are private service-owned tables until the domain layer is wired.
-- ---------------------------------------------------------------------------

create table if not exists relife.patient_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  patient_id text not null,
  purpose text not null check (purpose in (
    'care_delivery',
    'internal_quality_improvement',
    'research',
    'ai_model_development',
    'commercial_secondary_use',
    'marketing'
  )),
  status text not null check (status in ('granted', 'withdrawn', 'denied', 'expired')),
  notice_version text not null,
  recorded_by text not null,
  evidence_ref text not null default '',
  granted_at timestamptz,
  withdrawn_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id)
    on delete restrict
);

create index if not exists patient_consents_patient_idx
  on relife.patient_consents (organization_id, clinic_id, patient_id, purpose, created_at desc);

create table if not exists relife.data_provenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  source_system text not null,
  source_type text not null,
  ai_generated boolean not null default false,
  human_verified boolean not null default false,
  model_name text not null default '',
  model_version text not null default '',
  schema_version text not null,
  provenance_timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id)
    on delete restrict
);

create index if not exists data_provenance_entity_idx
  on relife.data_provenance (organization_id, clinic_id, entity_type, entity_id);

create table if not exists relife.retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  data_category text not null,
  retention_days integer check (retention_days is null or retention_days > 0),
  legal_basis text not null default '',
  policy_version text not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  archive_rule text not null default 'retain',
  deletion_rule text not null default 'manual_review',
  created_at timestamptz not null default now(),
  foreign key (organization_id)
    references relife.organizations (id)
    on delete restrict,
  unique (organization_id, data_category, policy_version)
);

create table if not exists relife.data_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  actor_user_id uuid,
  actor_staff_id text not null default '',
  access_type text not null check (access_type in ('read', 'export', 'denied', 'admin')),
  entity_type text not null,
  entity_id text not null default '',
  purpose text not null default '',
  result text not null check (result in ('allowed', 'denied')),
  denial_reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id)
    on delete restrict
);

create index if not exists data_access_events_tenant_time_idx
  on relife.data_access_events (organization_id, clinic_id, created_at desc);
create index if not exists data_access_events_actor_time_idx
  on relife.data_access_events (actor_user_id, created_at desc)
  where actor_user_id is not null;

alter table relife.patient_consents enable row level security;
alter table relife.data_provenance enable row level security;
alter table relife.retention_policies enable row level security;
alter table relife.data_access_events enable row level security;

revoke all on table relife.patient_consents from anon, authenticated;
revoke all on table relife.data_provenance from anon, authenticated;
revoke all on table relife.retention_policies from anon, authenticated;
revoke all on table relife.data_access_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Separate analytics-ready schema. No direct identifiers are stored here.
-- IMPORTANT: opaque subject keys are pseudonymous linkage, not proof of anonymity.
-- ---------------------------------------------------------------------------

create schema if not exists relife_analytics;
revoke all on schema relife_analytics from public, anon, authenticated;

-- Re-identification link remains in the private operational schema, never in
-- the analytics schema itself.
create table if not exists relife.analytics_subject_links (
  subject_key uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  source_patient_id text not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id)
    on delete restrict,
  unique (organization_id, clinic_id, source_patient_id),
  unique (organization_id, clinic_id, subject_key)
);

alter table relife.analytics_subject_links enable row level security;
revoke all on table relife.analytics_subject_links from anon, authenticated;

create table if not exists relife_analytics.outcome_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  subject_key uuid not null,
  age_band text not null default '',
  sex_category text not null default '',
  condition_code text not null default '',
  treatment_group text not null default '',
  baseline_metrics jsonb not null default '{}'::jsonb,
  final_metrics jsonb not null default '{}'::jsonb,
  sessions_count integer not null default 0 check (sessions_count >= 0),
  recovery_days integer check (recovery_days is null or recovery_days >= 0),
  outcome_status text not null default '',
  source_schema_version text not null,
  generated_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id, subject_key)
    references relife.analytics_subject_links (organization_id, clinic_id, subject_key)
    on delete restrict
);

create index if not exists outcome_facts_tenant_condition_idx
  on relife_analytics.outcome_facts (organization_id, clinic_id, condition_code, generated_at desc);

alter table relife_analytics.outcome_facts enable row level security;
revoke all on table relife_analytics.outcome_facts from anon, authenticated;

comment on schema relife_analytics is
  'Analytics-ready pseudonymous schema. It contains no direct patient identifiers and is not automatically anonymous/shareable.';
comment on table relife_analytics.outcome_facts is
  'Derived outcome facts only. Population requires consent/purpose/governance checks in a later controlled pipeline.';
