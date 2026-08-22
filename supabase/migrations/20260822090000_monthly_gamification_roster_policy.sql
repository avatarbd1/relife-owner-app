create table if not exists relife.monthly_gamification_finalizations (
  finalization_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  month_key text not null check (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  finalization_key text not null,
  source_cutoff_at timestamptz not null,
  roster_snapshot jsonb not null default '[]'::jsonb,
  config_snapshot jsonb not null default '{}'::jsonb,
  requested_by text not null,
  status text not null default 'running' check (status in ('running','finalized','failed')),
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint monthly_gamification_finalizations_tenant_fk
    foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint monthly_gamification_finalizations_key_uidx
    unique (clinic_id, finalization_key),
  constraint monthly_gamification_finalizations_month_uidx
    unique (clinic_id, month_key)
);

create index if not exists monthly_gamification_finalizations_status_idx
  on relife.monthly_gamification_finalizations (clinic_id, month_key desc, status);

alter table relife.monthly_gamification_finalizations enable row level security;
revoke all on table relife.monthly_gamification_finalizations from anon, authenticated;

with tenant as (
  select o.id as organization_id, c.id as clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife' and c.slug = 'amtali-main'
  limit 1
), next_version as (
  select coalesce(max(g.version), 0) + 1 as version
  from relife.gamification_config g
  join tenant t on t.clinic_id = g.clinic_id
  where g.department = 'Dental' and g.config_key = 'score.role.dentist'
)
insert into relife.gamification_config(
  organization_id, clinic_id, department, config_key, version,
  config_value, status, effective_from, updated_by
)
select
  t.organization_id, t.clinic_id, 'Dental', 'score.role.dentist', v.version,
  '{"enabled":true,"scale":100,"targets":{"sessions_per_week":8,"attendance_days_per_week":5},"weights":{"productivity":0.40,"attendance":0.20,"documentation":0.15,"quality":0.15,"reliability":0.10}}'::jsonb,
  'active', now(), 'owner_issue_159'
from tenant t cross join next_version v
where not exists (
  select 1 from relife.gamification_config g
  where g.clinic_id = t.clinic_id and g.department = 'Dental'
    and g.config_key = 'score.role.dentist' and g.status = 'active'
);

with tenant as (
  select o.id as organization_id, c.id as clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife' and c.slug = 'amtali-main'
  limit 1
), next_version as (
  select coalesce(max(g.version), 0) + 1 as version
  from relife.gamification_config g
  join tenant t on t.clinic_id = g.clinic_id
  where g.department = 'All' and g.config_key = 'reward.monthly_score_tiers'
)
insert into relife.gamification_config(
  organization_id, clinic_id, department, config_key, version,
  config_value, status, effective_from, updated_by
)
select
  t.organization_id, t.clinic_id, 'All', 'reward.monthly_score_tiers', v.version,
  jsonb_build_object(
    'enabled', true,
    'mode', 'score_tiers',
    'cash_budget_bdt', 1600,
    'bdt_per_credit', 10,
    'total_credits', 160,
    'reserve_credits', 6,
    'individual_cap', 22,
    'eligible_staff_ids', jsonb_build_array('ST002','ST003','ST004','ST005','ST008','ST010','ST011'),
    'tiers', jsonb_build_array(
      jsonb_build_object('min_score', 90, 'credits', 22),
      jsonb_build_object('min_score', 80, 'credits', 18),
      jsonb_build_object('min_score', 70, 'credits', 14),
      jsonb_build_object('min_score', 60, 'credits', 8)
    )
  ),
  'active', now(), 'owner_issue_159'
from tenant t cross join next_version v
where not exists (
  select 1 from relife.gamification_config g
  where g.clinic_id = t.clinic_id and g.department = 'All'
    and g.config_key = 'reward.monthly_score_tiers' and g.status = 'active'
);
