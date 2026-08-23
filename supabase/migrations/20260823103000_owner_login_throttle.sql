create table if not exists relife.owner_login_throttle (
  client_key text primary key check (client_key ~ '^[a-f0-9]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists owner_login_throttle_locked_until_idx
  on relife.owner_login_throttle (locked_until)
  where locked_until is not null;

alter table relife.owner_login_throttle enable row level security;
revoke all on table relife.owner_login_throttle from public, anon, authenticated;
