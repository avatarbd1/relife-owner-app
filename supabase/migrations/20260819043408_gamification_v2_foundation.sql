create table if not exists relife.performance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  role_context text not null,
  event_type text not null,
  event_key text not null,
  source_type text not null,
  source_id text not null,
  event_at timestamptz not null,
  metric_value numeric(14,4) not null default 1,
  quality_score numeric(6,2) check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  verified_by text not null default 'system',
  verification_method text not null default 'canonical_data',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint performance_events_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint performance_events_event_uidx unique (clinic_id, event_key),
  constraint performance_events_tenant_id_uidx unique (organization_id, clinic_id, id)
);

create table if not exists relife.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  role_context text not null,
  performance_event_id uuid not null,
  xp_awarded numeric(12,2) not null check (xp_awarded > 0),
  reason text not null,
  calculation_version text not null default 'v2',
  created_at timestamptz not null default now(),
  constraint xp_ledger_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint xp_ledger_event_fk foreign key (organization_id, clinic_id, performance_event_id)
    references relife.performance_events (organization_id, clinic_id, id) on delete restrict,
  constraint xp_ledger_event_uidx unique (performance_event_id)
);

create table if not exists relife.weekly_performance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  role_context text not null,
  week_start date not null,
  week_end date not null,
  normalized_score numeric(5,2) not null check (normalized_score >= 0 and normalized_score <= 100),
  score_components jsonb not null default '{}'::jsonb,
  xp_earned numeric(12,2) not null default 0 check (xp_earned >= 0),
  ranking_position integer check (ranking_position is null or ranking_position > 0),
  reward_credits_earned numeric(12,2) not null default 0 check (reward_credits_earned >= 0),
  calculation_version text not null default 'v2',
  status text not null default 'draft' check (status in ('draft','final','archived')),
  calculated_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_performance_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint weekly_performance_week_check check (week_end = week_start + 6),
  constraint weekly_performance_staff_uidx unique (clinic_id, week_start, staff_id)
);

create table if not exists relife.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  reward_key text not null,
  redemption_type text not null check (redemption_type in ('family_time','leave','voucher','treat','other')),
  credit_cost numeric(12,2) not null check (credit_cost > 0),
  requested_for date,
  request_notes text not null default '',
  coverage_status text not null default 'pending' check (coverage_status in ('not_required','pending','available','unavailable')),
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled','expired','claimed')),
  manager_decision_by text,
  manager_decision_at timestamptz,
  owner_decision_by text,
  owner_decision_at timestamptz,
  decision_reason text not null default '',
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_redemptions_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint reward_redemptions_tenant_id_uidx unique (organization_id, clinic_id, id)
);

create table if not exists relife.reward_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  entry_type text not null check (entry_type in (
    'earned','reserved','released','redeemed','refunded','expired','adjustment_credit','adjustment_debit'
  )),
  credit_amount numeric(12,2) not null check (credit_amount > 0),
  source_type text not null,
  source_id text not null,
  redemption_id uuid,
  related_entry_id uuid references relife.reward_credit_ledger(id) on delete restrict,
  idempotency_key text not null,
  reason text not null default '',
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  constraint reward_credit_ledger_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint reward_credit_ledger_redemption_fk foreign key (organization_id, clinic_id, redemption_id)
    references relife.reward_redemptions (organization_id, clinic_id, id) on delete restrict,
  constraint reward_credit_ledger_idempotency_uidx unique (clinic_id, idempotency_key),
  constraint reward_credit_ledger_redemption_check check (
    (entry_type in ('reserved','released','redeemed') and redemption_id is not null)
    or entry_type not in ('reserved','released','redeemed')
  )
);

create table if not exists relife.monthly_performance_bonuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  role_context text not null,
  month_start date not null,
  score_window jsonb not null default '[]'::jsonb,
  average_score numeric(5,2) not null check (average_score >= 0 and average_score <= 100),
  calculated_tier text not null check (calculated_tier in ('Bronze','Silver','Gold','Platinum')),
  base_bonus numeric(14,2) not null default 0 check (base_bonus >= 0),
  multipliers jsonb not null default '{}'::jsonb,
  proposed_final_bonus numeric(14,2) not null default 0 check (proposed_final_bonus >= 0),
  owner_adjustment numeric(14,2) not null default 0,
  owner_adjustment_reason text not null default '',
  final_bonus_amount numeric(14,2) not null default 0 check (final_bonus_amount >= 0),
  status text not null default 'calculated' check (status in ('calculated','pending_approval','approved','rejected','paid')),
  approved_by text,
  approved_at timestamptz,
  paid_at timestamptz,
  payroll_id text,
  calculation_version text not null default 'v2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_performance_bonuses_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint monthly_performance_bonuses_month_check check (extract(day from month_start) = 1),
  constraint monthly_performance_bonuses_staff_uidx unique (clinic_id, month_start, staff_id)
);

create table if not exists relife.team_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  department text not null default 'All' check (department in ('Physio','Dental','All')),
  month_start date not null,
  target_key text not null,
  target_name text not null,
  target_value numeric(16,4) not null,
  actual_value numeric(16,4) not null default 0,
  unit text not null default 'count',
  status text not null default 'active' check (status in ('active','hit','missed','closed')),
  reward_credits_per_staff numeric(12,2) not null default 0 check (reward_credits_per_staff >= 0),
  bonus_pool_amount numeric(14,2) not null default 0 check (bonus_pool_amount >= 0),
  celebration_type text not null default '',
  celebration_date date,
  calculation_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_targets_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint team_targets_month_check check (extract(day from month_start) = 1),
  constraint team_targets_key_uidx unique (clinic_id, month_start, department, target_key)
);

create table if not exists relife.gamification_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  department text not null default 'All' check (department in ('Physio','Dental','All')),
  config_key text not null,
  version integer not null default 1 check (version > 0),
  config_value jsonb not null,
  status text not null default 'active' check (status in ('active','archived')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  updated_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gamification_config_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint gamification_config_effective_check check (effective_until is null or effective_until > effective_from),
  constraint gamification_config_version_uidx unique (clinic_id, department, config_key, version)
);

create unique index if not exists gamification_config_active_uidx
  on relife.gamification_config (clinic_id, department, config_key)
  where status = 'active';

create index if not exists performance_events_staff_time_idx
  on relife.performance_events (clinic_id, staff_id, event_at desc);
create index if not exists performance_events_source_idx
  on relife.performance_events (clinic_id, source_type, source_id);
create index if not exists xp_ledger_staff_created_idx
  on relife.xp_ledger (clinic_id, staff_id, created_at desc);
create index if not exists weekly_performance_week_rank_idx
  on relife.weekly_performance (clinic_id, week_start desc, ranking_position);
create index if not exists weekly_performance_staff_week_idx
  on relife.weekly_performance (clinic_id, staff_id, week_start desc);
create index if not exists reward_redemptions_staff_status_idx
  on relife.reward_redemptions (clinic_id, staff_id, status, requested_at desc);
create unique index if not exists reward_redemptions_one_open_type_uidx
  on relife.reward_redemptions (clinic_id, staff_id, reward_key)
  where status in ('pending','approved');
create index if not exists reward_credit_ledger_staff_created_idx
  on relife.reward_credit_ledger (clinic_id, staff_id, created_at desc);
create index if not exists reward_credit_ledger_redemption_idx
  on relife.reward_credit_ledger (clinic_id, redemption_id, created_at)
  where redemption_id is not null;
create index if not exists monthly_performance_bonuses_month_status_idx
  on relife.monthly_performance_bonuses (clinic_id, month_start desc, status);
create index if not exists team_targets_month_idx
  on relife.team_targets (clinic_id, month_start desc, department, status);
create index if not exists gamification_config_lookup_idx
  on relife.gamification_config (clinic_id, department, config_key, status, version desc);

create or replace function relife.reject_gamification_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is append-only; append a correction/reversal entry instead', tg_table_name);
end
$$;

drop trigger if exists performance_events_append_only on relife.performance_events;
create trigger performance_events_append_only
before update or delete on relife.performance_events
for each row execute function relife.reject_gamification_append_only_mutation();

drop trigger if exists xp_ledger_append_only on relife.xp_ledger;
create trigger xp_ledger_append_only
before update or delete on relife.xp_ledger
for each row execute function relife.reject_gamification_append_only_mutation();

drop trigger if exists reward_credit_ledger_append_only on relife.reward_credit_ledger;
create trigger reward_credit_ledger_append_only
before update or delete on relife.reward_credit_ledger
for each row execute function relife.reject_gamification_append_only_mutation();

alter table relife.performance_events enable row level security;
alter table relife.xp_ledger enable row level security;
alter table relife.weekly_performance enable row level security;
alter table relife.reward_redemptions enable row level security;
alter table relife.reward_credit_ledger enable row level security;
alter table relife.monthly_performance_bonuses enable row level security;
alter table relife.team_targets enable row level security;
alter table relife.gamification_config enable row level security;

revoke all on table relife.performance_events from anon, authenticated;
revoke all on table relife.xp_ledger from anon, authenticated;
revoke all on table relife.weekly_performance from anon, authenticated;
revoke all on table relife.reward_redemptions from anon, authenticated;
revoke all on table relife.reward_credit_ledger from anon, authenticated;
revoke all on table relife.monthly_performance_bonuses from anon, authenticated;
revoke all on table relife.team_targets from anon, authenticated;
revoke all on table relife.gamification_config from anon, authenticated;

insert into relife.gamification_config (
  organization_id, clinic_id, department, config_key, config_value, updated_by
)
select relife.default_organization_id(), relife.default_clinic_id(), 'All', v.config_key, v.config_value, 'system:v2-foundation'
from (values
  ('bonus.tiers', '{"basis":"normalized_weekly_score_average_0_100","tiers":[{"key":"Bronze","min":0,"max":59.99,"bonus":0},{"key":"Silver","min":60,"max":74.99,"bonus":500},{"key":"Gold","min":75,"max":89.99,"bonus":1000},{"key":"Platinum","min":90,"max":100,"bonus":1500}]}'::jsonb),
  ('reward.weekly_rank', '{"rank_1":250,"rank_2":150,"rank_3":100,"participation":50}'::jsonb),
  ('reward.catalog', '{"items":[{"key":"two_hour_early_leave","type":"family_time","credit_cost":40,"cooldown_days":7,"max_per_month":2,"coverage_required":true},{"key":"half_day_family_time","type":"family_time","credit_cost":70,"cooldown_days":14,"max_per_month":2,"coverage_required":true},{"key":"paid_half_day","type":"leave","credit_cost":100,"cooldown_days":90,"max_per_quarter":1,"coverage_required":true},{"key":"priority_weekly_off","type":"leave","credit_cost":100,"cooldown_days":28,"max_per_month":1,"coverage_required":true},{"key":"family_treat_outing","type":"treat","credit_cost":150,"max_per_month":1,"coverage_required":false}]}'::jsonb),
  ('reward.weekly_winner_choices', '{"choices":["family_half_day","dinner_treat","voucher_300_500","priority_weekly_off","two_hour_early_leave"],"owner_approval_required":true}'::jsonb),
  ('bonus.multipliers', '{"streak":0.05,"team":0.20,"rating":0.10,"zero_incident":0.15,"owner_approval_required":true,"base_salary_untouched":true}'::jsonb),
  ('score.role.therapist', '{"enabled":true,"scale":100,"weights":{"productivity":0.40,"attendance":0.20,"documentation":0.15,"quality":0.15,"reliability":0.10}}'::jsonb),
  ('score.role.receptionist', '{"enabled":true,"scale":100,"weights":{"workflow":0.40,"cash_accuracy":0.25,"appointment_accuracy":0.15,"attendance":0.10,"error_control":0.10},"registration_phone_required_for_score":false}'::jsonb),
  ('score.role.manager', '{"enabled":true,"scale":100,"weights":{"coordination":0.30,"incidents":0.25,"schedule":0.20,"staff_satisfaction":0.15,"attendance":0.10}}'::jsonb),
  ('score.role.dentist', '{"enabled":false,"scale":100,"reason":"separate normalized Dentist weights are not yet locked"}'::jsonb),
  ('score.role.owner', '{"enabled":false,"scale":100,"reason":"normalized Owner weights and verified metric sources are not yet locked"}'::jsonb)
) as v(config_key, config_value)
where relife.default_organization_id() is not null
  and relife.default_clinic_id() is not null
on conflict do nothing;

comment on table relife.performance_events is 'Gamification v2 verified work-event source. Append-only; corrections are appended as new events.';
comment on table relife.xp_ledger is 'Gamification v2 lifetime XP ledger. Append-only; XP is never spent or reduced.';
comment on table relife.weekly_performance is 'Calculated weekly normalized 0-100 performance snapshot used for cross-role ranking.';
comment on table relife.reward_credit_ledger is 'Append-only Reward Credit ledger. Pending claims reserve credits; claimed rewards redeem them; rejected/cancelled claims release reservations.';
comment on table relife.reward_redemptions is 'Reward claim workflow. Coverage and approval state live here; ledger rows record financial-credit effects immutably.';
comment on table relife.monthly_performance_bonuses is 'Finance-controlled monthly performance bonus proposal/approval record. Base salary is not changed by gamification.';
comment on table relife.team_targets is 'Clinic-wide monthly target tracking and shared reward metadata.';
comment on table relife.gamification_config is 'Versioned Owner-controlled gamification configuration. Business thresholds and reward values are data, not UI constants.';
