alter table relife.reward_redemptions
  add column if not exists requested_by text not null default '',
  add column if not exists claimed_by text,
  add column if not exists state_version integer not null default 1 check (state_version > 0),
  add column if not exists config_version integer check (config_version is null or config_version > 0),
  add column if not exists policy_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists conflict_key text not null default '',
  add column if not exists idempotency_key text not null default '',
  add column if not exists eligible_after timestamptz;

create unique index if not exists reward_redemptions_request_idempotency_uidx
  on relife.reward_redemptions (clinic_id, idempotency_key)
  where idempotency_key <> '';

create unique index if not exists reward_redemptions_active_conflict_uidx
  on relife.reward_redemptions (clinic_id, staff_id, conflict_key)
  where conflict_key <> '' and status in ('pending','approved','claimed');

create index if not exists reward_redemptions_owner_queue_idx
  on relife.reward_redemptions (clinic_id, status, requested_at desc);

create index if not exists reward_redemptions_cooldown_idx
  on relife.reward_redemptions (clinic_id, staff_id, reward_key, claimed_at desc)
  where status = 'claimed';

create table if not exists relife.reward_redemption_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  redemption_id uuid not null,
  staff_id text not null,
  department text not null check (department in ('Physio','Dental','All')),
  event_type text not null check (event_type in ('requested','approved','denied','cancelled','claimed','expired')),
  state_version integer not null check (state_version > 0),
  event_key text not null,
  actor_id text not null,
  reason text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint reward_redemption_events_tenant_fk foreign key (organization_id, clinic_id)
    references relife.clinics (organization_id, id) on delete restrict,
  constraint reward_redemption_events_redemption_fk foreign key (organization_id, clinic_id, redemption_id)
    references relife.reward_redemptions (organization_id, clinic_id, id) on delete restrict,
  constraint reward_redemption_events_event_uidx unique (clinic_id, event_key)
);

create index if not exists reward_redemption_events_claim_idx
  on relife.reward_redemption_events (clinic_id, redemption_id, created_at);

create index if not exists reward_redemption_events_staff_idx
  on relife.reward_redemption_events (clinic_id, staff_id, created_at desc);

alter table relife.reward_redemption_events enable row level security;
revoke all on table relife.reward_redemption_events from anon, authenticated;

drop trigger if exists reward_redemption_events_append_only on relife.reward_redemption_events;
create trigger reward_redemption_events_append_only
before update or delete on relife.reward_redemption_events
for each row execute function relife.reject_gamification_append_only_mutation();