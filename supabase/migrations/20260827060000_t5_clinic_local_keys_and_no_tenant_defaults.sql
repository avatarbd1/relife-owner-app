-- T5: make confirmed clinic-local business keys tenant-scoped and remove
-- silent Relife tenant defaults from foundational operational tables.
--
-- Preconditions verified on production before this migration:
-- - patient_cache and treatment_plan_cache are empty.
-- - chamber_resources contains Tenant #1 resources; dependent
--   machine_reservations/equipment_requests are empty.
-- - appointment/session identifiers are random generated IDs, so this slice
--   intentionally does not rewrite those primary keys.

-- Tenant-owned runtime rows must fail closed when callers omit tenant identity.
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
    execute format('alter table relife.%I alter column organization_id drop default', t);
    execute format('alter table relife.%I alter column clinic_id drop default', t);
  end loop;
end
$$;

-- Patient IDs are clinic-local (for example PT/DT series) and may repeat in
-- different clinics. Cache identity must therefore include the tenant key.
alter table relife.patient_cache
  drop constraint patient_cache_pkey,
  add constraint patient_cache_pkey
    primary key (organization_id, clinic_id, patient_id);

alter table relife.treatment_plan_cache
  drop constraint treatment_plan_cache_pkey,
  add constraint treatment_plan_cache_pkey
    primary key (organization_id, clinic_id, patient_id);

-- Chamber resource IDs are deliberately local labels such as BED-1 and must be
-- reusable by every clinic. Rebuild dependent foreign keys on the same tenant.
alter table relife.equipment_requests
  drop constraint equipment_requests_resource_id_fkey;

alter table relife.machine_reservations
  drop constraint machine_reservations_resource_id_fkey;

alter table relife.chamber_resources
  drop constraint chamber_resources_pkey,
  add constraint chamber_resources_pkey
    primary key (organization_id, clinic_id, resource_id);

alter table relife.equipment_requests
  add constraint equipment_requests_resource_tenant_fkey
    foreign key (organization_id, clinic_id, resource_id)
    references relife.chamber_resources (organization_id, clinic_id, resource_id)
    on delete restrict;

alter table relife.machine_reservations
  add constraint machine_reservations_resource_tenant_fkey
    foreign key (organization_id, clinic_id, resource_id)
    references relife.chamber_resources (organization_id, clinic_id, resource_id)
    on delete restrict;

comment on constraint patient_cache_pkey on relife.patient_cache is
  'T5 tenant-scoped clinic-local patient identity.';
comment on constraint treatment_plan_cache_pkey on relife.treatment_plan_cache is
  'T5 tenant-scoped clinic-local patient identity.';
comment on constraint chamber_resources_pkey on relife.chamber_resources is
  'T5 tenant-scoped clinic-local Chamber resource identity.';
