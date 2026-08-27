-- Phase A — canonical tenant configuration foundation.
--
-- Establishes the configuration data model required by
-- docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md sections 5, 7, 8, 9, 15 and 21 so a
-- clinic's normal differences become data instead of source-code conditions.
--
-- Scope boundaries for this slice:
--
-- * Schema only. No onboarding wizard, no UI, no provisioning writer, and no
--   Clinic #2 activation. Those are Phase B/C/F work.
-- * No seed rows. A migration must never decide which clinic gets what; doing so
--   would reintroduce exactly the fixed-tenant pattern this contract removes.
-- * relife.chamber_resources is deliberately left untouched. Contract section 15
--   lists Room/Bed Runtime as an optional module distinct from core facility
--   configuration, and the booking/Chamber-runtime separation is preserved.
--   Reconciling the runtime allocation table against this configuration layer is
--   Phase C work with its own migration.
--
-- Conventions follow relife.gamification_config and the T5 slice already
-- applied: explicit dual tenant key with no column defaults, composite FK to
-- relife.clinics (organization_id, id), and client-private RLS.
--
-- Rollback: every object here is additive and unreferenced by existing runtime
-- code, so rollback is `drop table` in reverse dependency order plus restoring
-- the clinics status check to its previous two-value form. No row rewrite of an
-- existing table is performed except the widened clinics.status check.

-- ---------------------------------------------------------------------------
-- 1. Clinic lifecycle (contract section 21)
-- ---------------------------------------------------------------------------
-- Existing check allowed only ('active','inactive'). The canonical lifecycle
-- has six states, and suspension must never imply data deletion.

alter table relife.clinics
  drop constraint if exists clinics_status_check;

-- Legacy values map to a non-serving state, never to 'active'. The previous
-- check allowed 'inactive', so widening the lifecycle must not silently promote
-- a clinic that was deliberately switched off into one that serves traffic.
-- 'archived' is chosen over 'suspended' so returning such a clinic to service
-- requires an explicit decision rather than happening by omission.
update relife.clinics
  set status = 'archived'
  where status not in ('draft','setup','ready','active','suspended','archived');

alter table relife.clinics
  add constraint clinics_status_check
  check (status in ('draft','setup','ready','active','suspended','archived'));

-- The column default was 'active', from the two-state era where a clinic row and
-- a serving clinic were the same thing. Under the canonical lifecycle they are
-- not: a clinic must pass the readiness gate before it serves traffic. Leaving
-- the old default would mean a provisioning insert that omits status creates an
-- immediately-serving clinic, silently bypassing that gate.
--
-- This changes the default for future inserts only. Existing rows keep the
-- status they already hold, so the current active clinic stays active.
alter table relife.clinics
  alter column status set default 'draft';

comment on column relife.clinics.status is
  'Canonical clinic lifecycle. Defaults to draft so an omitted status fails closed; only active serves production traffic.';

-- ---------------------------------------------------------------------------
-- 2. Clinic profile settings (contract section 5)
-- ---------------------------------------------------------------------------

create table if not exists relife.clinic_settings (
  organization_id uuid not null,
  clinic_id uuid not null,
  clinic_type text not null default 'other'
    check (clinic_type in ('physiotherapy','dental','doctor_chamber','other')),
  branch_name text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  logo_url text not null default '',
  currency text not null default 'BDT',
  locale text not null default 'en',
  updated_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id),
  constraint clinic_settings_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.clinic_settings is
  'Per-clinic profile configuration. Timezone stays on relife.clinics as the canonical scheduling anchor.';

-- ---------------------------------------------------------------------------
-- 3. Operating hours and weekly holidays (contract section 5)
-- ---------------------------------------------------------------------------
-- One row per weekday. day_of_week follows ISO 8601: 1 = Monday .. 7 = Sunday.

create table if not exists relife.clinic_operating_hours (
  organization_id uuid not null,
  clinic_id uuid not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  is_open boolean not null default true,
  opens_at time,
  closes_at time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, day_of_week),
  constraint clinic_operating_hours_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  -- An open day needs both ends of the window; a closed day needs neither.
  constraint clinic_operating_hours_window_check check (
    (is_open = false and opens_at is null and closes_at is null)
    or (is_open = true and opens_at is not null and closes_at is not null and closes_at > opens_at)
  )
);

comment on table relife.clinic_operating_hours is
  'Weekly opening schedule. A missing row means the day is unconfigured, which readiness must treat as incomplete rather than open.';

-- ---------------------------------------------------------------------------
-- 4. Feature catalog, per-clinic flags, and commercial entitlements
--    (contract section 15)
-- ---------------------------------------------------------------------------
-- The contract requires product capability and commercial purchase to be
-- modelled separately: a feature can be technically enabled for support or
-- migration reasons without being sold, and a purchased feature can be
-- temporarily disabled by the clinic. Both must be true for access.

create table if not exists relife.feature_catalog (
  feature_key text primary key,
  label text not null,
  description text not null default '',
  module_group text not null check (module_group in ('core','optional')),
  domain text not null check (domain in (
    'core','patients','appointments','staff','services','finance','reports',
    'clinical','facility','chamber','inventory','messaging','engagement','files','audit'
  )),
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table relife.feature_catalog is
  'Enumerable product surface. Free-text feature keys are refused so a typo cannot silently open a gate.';

-- Core modules per contract section 15. Listed as catalog rows, not as grants:
-- enabling them for a clinic is still an explicit configuration decision.
insert into relife.feature_catalog (feature_key, label, module_group, domain, description) values
  ('core.dashboard',     'Dashboard',        'core', 'core',         'Clinic summary landing surface.'),
  ('core.patients',      'Patients',         'core', 'patients',     'Patient registration and records.'),
  ('core.appointments',  'Appointments',     'core', 'appointments', 'Booking and schedule.'),
  ('core.staff',         'Staff',            'core', 'staff',        'Staff directory, roles and memberships.'),
  ('core.services',      'Services',         'core', 'services',     'Service catalog and pricing.'),
  ('core.finance_basic', 'Basic finance',    'core', 'finance',      'Payments, expenses and daily collection.'),
  ('core.reports',       'Reports',          'core', 'reports',      'Operational and financial reporting.'),
  ('core.settings',      'Profile settings', 'core', 'core',         'Clinic profile and account settings.'),

  ('optional.live_chamber',      'Live Chamber',     'optional', 'chamber',    'Live treatment floor board and session running.'),
  ('optional.room_bed_runtime',  'Room/bed runtime', 'optional', 'facility',   'Runtime allocation of rooms, beds and stations.'),
  ('optional.clinical_notes',    'Clinical notes',   'optional', 'clinical',   'Assessment and clinical documentation.'),
  ('optional.treatment_plans',   'Treatment plans',  'optional', 'clinical',   'Structured treatment planning.'),
  ('optional.packages',          'Packages',         'optional', 'services',   'Multi-session package sales.'),
  ('optional.attendance',        'Attendance',       'optional', 'staff',      'Staff attendance tracking.'),
  ('optional.salary',            'Salary',           'optional', 'finance',    'Salary configuration and payouts.'),
  ('optional.inventory',         'Inventory',        'optional', 'inventory',  'Stock and consumables.'),
  ('optional.sms',               'SMS',              'optional', 'messaging',  'Outbound SMS.'),
  ('optional.notifications',     'Notifications',    'optional', 'messaging',  'In-app and push notifications.'),
  ('optional.files',             'Files/documents',  'optional', 'files',      'Patient file and document storage.'),
  ('optional.audit_viewer',      'Audit viewer',     'optional', 'audit',      'Audit trail browsing.'),
  ('optional.finance_advanced',  'Advanced finance', 'optional', 'finance',    'Cash custody, approvals, treasury workflows.'),
  ('optional.machines',          'Machines',         'optional', 'facility',   'Machine and equipment scheduling.'),
  ('optional.gamification',      'Gamification',     'optional', 'engagement', 'Performance scoring, XP and leaderboard.'),
  ('optional.rewards',           'Rewards',          'optional', 'engagement', 'Reward claims and redemption.'),
  ('optional.live_chat',         'Live chat',        'optional', 'messaging',  'Realtime staff chat.')
on conflict (feature_key) do update set
  label = excluded.label,
  module_group = excluded.module_group,
  domain = excluded.domain,
  description = excluded.description,
  updated_at = now();

-- Product capability: is this feature switched on for this clinic.
create table if not exists relife.clinic_feature_flags (
  organization_id uuid not null,
  clinic_id uuid not null,
  feature_key text not null references relife.feature_catalog (feature_key) on delete restrict,
  enabled boolean not null default false,
  enabled_by text not null default 'system',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, feature_key),
  constraint clinic_feature_flags_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.clinic_feature_flags is
  'Per-clinic product capability. Absence means disabled; there is deliberately no implicit default-on.';

-- Commercial purchase, tracked separately from capability per contract section 15.
create table if not exists relife.clinic_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  feature_key text not null references relife.feature_catalog (feature_key) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  source text not null default 'plan' check (source in ('plan','trial','manual','migration')),
  plan_code text not null default '',
  grant_reason text not null default '',
  granted_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_entitlements_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint clinic_entitlements_window_check
    check (effective_until is null or effective_until > effective_from)
);

comment on table relife.clinic_entitlements is
  'Commercial grant of a feature to a clinic. Temporal so trials and lapsed plans stop granting without a revoke job.';

-- One live grant per clinic per feature; expired and revoked rows stay for billing history.
create unique index if not exists clinic_entitlements_active_uidx
  on relife.clinic_entitlements (organization_id, clinic_id, feature_key)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 5. Facility configuration (contract section 7)
-- ---------------------------------------------------------------------------
-- Canonical hierarchy: Organization -> Clinic -> Room/Area -> Resource.
-- room_code and resource_code are clinic-local labels such as 'ROOM-1' or
-- 'BED-1'. They are tenant scoped so every clinic may reuse the same labels.

create table if not exists relife.clinic_rooms (
  organization_id uuid not null,
  clinic_id uuid not null,
  room_code text not null,
  display_name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, room_code),
  constraint clinic_rooms_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.clinic_rooms is
  'Clinic-local rooms/areas. A clinic with no rooms simply has no rows here.';

create table if not exists relife.clinic_resources (
  organization_id uuid not null,
  clinic_id uuid not null,
  resource_code text not null,
  display_name text not null,
  resource_type text not null check (resource_type in (
    'BED','DENTAL_CHAIR','TREATMENT_TABLE','CABIN','ROOM','MACHINE','OTHER'
  )),
  -- Optional parent room/area. Null means the resource is not inside a
  -- configured room, which is legitimate for a single-space clinic.
  room_code text,
  capacity integer not null default 1 check (capacity > 0),
  -- Optional gender restriction. Null means unrestricted; the product must not
  -- assume Relife's gender-segregated room policy for other clinics.
  gender_restriction text check (gender_restriction in ('Male','Female')),
  is_bookable boolean not null default false,
  is_runtime_only boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, resource_code),
  constraint clinic_resources_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  -- A resource's parent room must belong to the same clinic; this composite FK
  -- is what makes a cross-tenant parent reference impossible.
  constraint clinic_resources_room_fk foreign key (organization_id, clinic_id, room_code)
    references relife.clinic_rooms (organization_id, clinic_id, room_code) on delete restrict
);

comment on table relife.clinic_resources is
  'Generic facility resources. Type is configuration, so bed count and layout are clinic data rather than a product rule.';

-- ---------------------------------------------------------------------------
-- 6. Services and pricing (contract section 9)
-- ---------------------------------------------------------------------------

create table if not exists relife.clinic_services (
  organization_id uuid not null,
  clinic_id uuid not null,
  service_code text not null,
  display_name text not null,
  department text not null default 'All' check (department in ('Physio','Dental','All')),
  price numeric(12,2) not null default 0 check (price >= 0),
  duration_min integer not null default 30 check (duration_min > 0),
  requires_booking boolean not null default true,
  requires_provider boolean not null default true,
  requires_resource boolean not null default false,
  discount_applicable boolean not null default true,
  tax_applicable boolean not null default false,
  package_eligible boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, service_code),
  constraint clinic_services_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.clinic_services is
  'Per-clinic service catalog. Relife prices and service names are never universal defaults.';

-- ---------------------------------------------------------------------------
-- 7. Booking configuration (contract section 8)
-- ---------------------------------------------------------------------------
-- Three modes. 'capacity' is the contract's preferred general default because
-- exact physical assignment belongs to treatment runtime, not booking.

create table if not exists relife.clinic_booking_config (
  organization_id uuid not null,
  clinic_id uuid not null,
  booking_mode text not null default 'simple'
    check (booking_mode in ('simple','capacity','specific_resource')),
  default_duration_min integer not null default 30 check (default_duration_min > 0),
  slot_interval_min integer not null default 30 check (slot_interval_min > 0),
  max_simultaneous integer check (max_simultaneous is null or max_simultaneous > 0),
  provider_required boolean not null default true,
  resource_required boolean not null default false,
  block_duplicate_patient_overlap boolean not null default true,
  allow_walk_in boolean not null default true,
  cancellation_notice_min integer not null default 0 check (cancellation_notice_min >= 0),
  late_arrival_grace_min integer not null default 0 check (late_arrival_grace_min >= 0),
  -- Clinic-specific safety rules such as gender separation. Empty object means
  -- no extra rules, which must stay the default for a new clinic.
  capacity_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id),
  constraint clinic_booking_config_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  -- Capacity mode is meaningless without a configured ceiling, and
  -- specific-resource mode is meaningless without requiring a resource.
  constraint clinic_booking_config_mode_check check (
    (booking_mode <> 'capacity' or max_simultaneous is not null)
    and (booking_mode <> 'specific_resource' or resource_required = true)
  )
);

comment on table relife.clinic_booking_config is
  'Per-clinic booking behaviour. specific_resource is opt-in; it is never assumed globally.';

-- ---------------------------------------------------------------------------
-- 8. Operational data-source and storage mapping (contract section 3)
-- ---------------------------------------------------------------------------
-- Records where a clinic's operational data and files actually live, so routing
-- stops being a compiled constant. Sheets remains a legacy/import/export
-- compatibility source rather than the canonical realtime database.

create table if not exists relife.clinic_data_sources (
  organization_id uuid not null,
  clinic_id uuid not null,
  source_kind text not null check (source_kind in (
    'sheets_workbook','storage_bucket','storage_prefix','export_target'
  )),
  source_role text not null,
  source_ref text not null,
  is_legacy boolean not null default false,
  status text not null default 'active' check (status in ('active','retired')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, clinic_id, source_kind, source_role),
  constraint clinic_data_sources_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict
);

comment on table relife.clinic_data_sources is
  'Clinic-aware data-source and storage mapping. Replaces compiled per-department routing constants.';

-- ---------------------------------------------------------------------------
-- 9. Indexes
-- ---------------------------------------------------------------------------
-- Composite primary keys already cover the (organization_id, clinic_id) prefix
-- for tenant-scoped reads. These add the referencing-side indexes for the
-- feature FKs and the resource parent FK, matching the existing *_fk_indexes
-- convention.

create index if not exists clinic_feature_flags_feature_idx
  on relife.clinic_feature_flags (feature_key);

create index if not exists clinic_entitlements_feature_idx
  on relife.clinic_entitlements (feature_key);

create index if not exists clinic_entitlements_lookup_idx
  on relife.clinic_entitlements (organization_id, clinic_id, feature_key, status, effective_from);

create index if not exists clinic_resources_room_idx
  on relife.clinic_resources (organization_id, clinic_id, room_code);

create index if not exists clinic_resources_type_idx
  on relife.clinic_resources (organization_id, clinic_id, resource_type)
  where is_active = true;

create index if not exists clinic_services_active_idx
  on relife.clinic_services (organization_id, clinic_id, department)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- 10. Client-private RLS
-- ---------------------------------------------------------------------------
-- These tables carry commercial terms and clinic configuration and are reached
-- only through the trusted server/service-role path, matching the T4 baseline
-- decision for operational tenant tables. Ordinary RLS is not treated as
-- protection for privileged traffic; that enforcement lives in the server code.

-- Browser roles are denied; the trusted server path is granted explicitly,
-- following the pattern already used by the staff tenant membership migration.
-- service_role bypasses RLS in Supabase, but the table privilege still has to
-- exist or every server read of these tables fails.

grant usage on schema relife to service_role;

do $$
declare
  t text;
  config_tables text[] := array[
    'clinic_settings',
    'clinic_operating_hours',
    'feature_catalog',
    'clinic_feature_flags',
    'clinic_entitlements',
    'clinic_rooms',
    'clinic_resources',
    'clinic_services',
    'clinic_booking_config',
    'clinic_data_sources'
  ];
begin
  foreach t in array config_tables loop
    execute format('alter table relife.%I enable row level security', t);
    execute format('revoke all on table relife.%I from anon, authenticated', t);
    -- Postgres has no `create policy if not exists`, so the drop makes this
    -- block re-runnable. Re-running a migration is the natural recovery after a
    -- partial failure, and without this the retry aborts on the first policy.
    execute format('drop policy if exists %I on relife.%I', t || '_deny_anon', t);
    execute format(
      'create policy %I on relife.%I for all to anon using (false) with check (false)',
      t || '_deny_anon', t
    );
    execute format(
      'drop policy if exists %I on relife.%I', t || '_deny_authenticated', t
    );
    execute format(
      'create policy %I on relife.%I for all to authenticated using (false) with check (false)',
      t || '_deny_authenticated', t
    );
    execute format(
      'grant select, insert, update, delete on table relife.%I to service_role', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Feature resolution
-- ---------------------------------------------------------------------------
-- A feature is usable only when the clinic has it switched on AND holds a valid
-- commercial grant. Every unknown resolves to false: unknown feature, retired
-- feature, missing flag, disabled flag, missing grant, suspended or revoked
-- grant, and expired window.

create or replace function relife.clinic_feature_enabled(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_feature_key text,
  p_at timestamptz default now()
) returns boolean
language sql
stable
security invoker
set search_path = relife, pg_catalog
as $$
  select exists (
    select 1
    from relife.clinic_feature_flags f
    join relife.feature_catalog c on c.feature_key = f.feature_key
    join relife.clinic_entitlements e
      on e.organization_id = f.organization_id
     and e.clinic_id = f.clinic_id
     and e.feature_key = f.feature_key
    where f.organization_id = p_organization_id
      and f.clinic_id = p_clinic_id
      and f.feature_key = p_feature_key
      and f.enabled = true
      and c.status = 'active'
      and e.status = 'active'
      and e.effective_from <= p_at
      and (e.effective_until is null or e.effective_until > p_at)
  );
$$;

comment on function relife.clinic_feature_enabled is
  'Single definition of feature access: capability AND commercial grant, both fail closed.';

revoke all on function relife.clinic_feature_enabled(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function relife.clinic_feature_enabled(uuid, uuid, text, timestamptz)
  to service_role;
