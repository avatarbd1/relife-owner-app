create table if not exists relife.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references relife.organizations(id),
  clinic_id uuid not null references relife.clinics(id),
  request_id text not null,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  patient_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_request_action_uidx unique (clinic_id, request_id, action)
);

create index if not exists audit_events_clinic_created_idx
  on relife.audit_events (clinic_id, created_at desc);
create index if not exists audit_events_clinic_entity_idx
  on relife.audit_events (clinic_id, entity_type, entity_id);

alter table relife.audit_events enable row level security;
