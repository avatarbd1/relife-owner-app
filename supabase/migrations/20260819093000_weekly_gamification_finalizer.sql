create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists relife.weekly_gamification_finalizations (
  finalization_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  week_start date not null,
  week_end date not null,
  finalization_key text not null,
  source_cutoff_at timestamptz not null,
  config_snapshot jsonb not null default '{}'::jsonb,
  trigger_source text not null default 'cron' check (trigger_source in ('cron','owner_manual','system_recovery')),
  requested_by text not null default 'system',
  status text not null default 'running' check (status in ('running','finalized','failed')),
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint weekly_gamification_finalizations_tenant_fk
    foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint weekly_gamification_finalizations_week_check
    check (week_end = week_start + 6),
  constraint weekly_gamification_finalizations_key_uidx
    unique (clinic_id, finalization_key),
  constraint weekly_gamification_finalizations_week_uidx
    unique (clinic_id, week_start),
  constraint weekly_gamification_finalizations_tenant_id_uidx
    unique (organization_id, clinic_id, finalization_id)
);

alter table relife.weekly_performance
  alter column normalized_score drop not null;

alter table relife.weekly_performance
  add column if not exists provisional_score numeric(5,2)
    check (provisional_score is null or (provisional_score >= 0 and provisional_score <= 100)),
  add column if not exists score_covered_weight numeric(6,4) not null default 0
    check (score_covered_weight >= 0 and score_covered_weight <= 1),
  add column if not exists missing_score_metrics jsonb not null default '[]'::jsonb,
  add column if not exists finalization_id uuid,
  add column if not exists score_config_version integer,
  add column if not exists earning_config_version integer,
  add column if not exists config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists source_cutoff_at timestamptz,
  add column if not exists eligibility_reason text not null default 'not_finalized';

create unique index if not exists weekly_performance_tenant_id_uidx
  on relife.weekly_performance (organization_id, clinic_id, id);

alter table relife.weekly_performance
  drop constraint if exists weekly_performance_finalization_fk;
alter table relife.weekly_performance
  add constraint weekly_performance_finalization_fk
  foreign key (organization_id, clinic_id, finalization_id)
  references relife.weekly_gamification_finalizations (organization_id, clinic_id, finalization_id)
  on delete restrict;

alter table relife.reward_credit_ledger
  add column if not exists weekly_performance_id uuid,
  add column if not exists score_snapshot jsonb not null default '{}'::jsonb;

alter table relife.reward_credit_ledger
  drop constraint if exists reward_credit_ledger_weekly_performance_fk;
alter table relife.reward_credit_ledger
  add constraint reward_credit_ledger_weekly_performance_fk
  foreign key (organization_id, clinic_id, weekly_performance_id)
  references relife.weekly_performance (organization_id, clinic_id, id)
  on delete restrict;

create index if not exists weekly_gamification_finalizations_status_idx
  on relife.weekly_gamification_finalizations (clinic_id, week_start desc, status);
create index if not exists weekly_performance_finalization_idx
  on relife.weekly_performance (clinic_id, finalization_id, role_context, status);
create index if not exists reward_credit_ledger_weekly_performance_idx
  on relife.reward_credit_ledger (clinic_id, weekly_performance_id, created_at)
  where weekly_performance_id is not null;

alter table relife.weekly_gamification_finalizations enable row level security;
revoke all on table relife.weekly_gamification_finalizations from anon, authenticated;

with tenant as (
  select o.id as organization_id, c.id as clinic_id
  from relife.organizations o
  join relife.clinics c on c.organization_id = o.id
  where o.slug = 'relife'
    and c.slug = 'amtali-main'
  limit 1
), next_version as (
  select coalesce(max(g.version), 0) + 1 as version
  from relife.gamification_config g
  join tenant t on t.clinic_id = g.clinic_id
  where g.department = 'All'
    and g.config_key = 'reward.weekly_score_tiers'
)
insert into relife.gamification_config(
  organization_id,
  clinic_id,
  department,
  config_key,
  version,
  config_value,
  status,
  effective_from,
  updated_by
)
select
  t.organization_id,
  t.clinic_id,
  'All',
  'reward.weekly_score_tiers',
  v.version,
  jsonb_build_object(
    'enabled', false,
    'mode', 'score_tiers',
    'rank_bonus_enabled', false,
    'roles', jsonb_build_object(
      'Therapist', '[]'::jsonb,
      'Receptionist', '[]'::jsonb
    )
  ),
  'active',
  now(),
  'system_migration'
from tenant t
cross join next_version v
where not exists (
  select 1
  from relife.gamification_config g
  where g.clinic_id = t.clinic_id
    and g.department = 'All'
    and g.config_key = 'reward.weekly_score_tiers'
    and g.status = 'active'
);

select cron.schedule(
  'weekly-gamification-finalizer',
  '15 18 * * 0',
  $cron$
  select net.http_post(
    url := coalesce(
      (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_gamification_finalizer_url' limit 1),
      ''
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-relife-server-key', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_gamification_finalizer_key' limit 1),
        ''
      )
    ),
    body := jsonb_build_object(
      'action', 'finalize_previous_week',
      'trigger', 'cron'
    )
  ) as request_id;
  $cron$
);
