-- Distributed mutation lock table for cross-instance finance operation serialization
-- Supports lease-based locking for Google Sheets mutations (which happen outside Postgres transaction)

create table if not exists public.distributed_mutation_lock (
  lock_key text primary key,
  owner_id text not null,
  token uuid not null default gen_random_uuid(),
  acquired_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  status text not null default 'active' check (status in ('active', 'released', 'expired')),
  created_at timestamp with time zone not null default now(),

  constraint lock_key_format check (lock_key ~ '^[a-z0-9:_-]+$'),
  constraint owner_id_not_empty check (owner_id != ''),
  constraint expires_after_acquired check (expires_at > acquired_at)
);

create index idx_distributed_mutation_lock_owner_id on public.distributed_mutation_lock(owner_id);
create index idx_distributed_mutation_lock_expires_at on public.distributed_mutation_lock(expires_at);
create index idx_distributed_mutation_lock_status on public.distributed_mutation_lock(status);

-- Enable RLS
alter table public.distributed_mutation_lock enable row level security;

-- Allow all authenticated users to read lock state
create policy "read_lock_state" on public.distributed_mutation_lock
  for select
  using (true);

-- Allow authenticated users to acquire locks (insert)
create policy "acquire_lock" on public.distributed_mutation_lock
  for insert
  with check (true);

-- Allow lock owner to release locks
create policy "release_lock_by_owner" on public.distributed_mutation_lock
  for update
  using (owner_id = current_user_id())
  with check (owner_id = current_user_id());

-- Cleanup function for expired locks (call periodically)
create or replace function public.cleanup_expired_locks()
returns void
language sql
as $$
  delete from public.distributed_mutation_lock
  where status = 'expired'
    and expires_at < now()
    and now() - expires_at > interval '1 hour';
$$;

-- Acquire lock function (idempotent)
-- Returns true if lock acquired, false if already held by another owner
create or replace function public.acquire_distributed_lock(
  p_lock_key text,
  p_owner_id text,
  p_timeout_seconds int default 30
)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_token uuid;
  v_current_owner text;
  v_is_expired boolean;
begin
  -- Try to acquire lock with upsert
  insert into public.distributed_mutation_lock (lock_key, owner_id, expires_at, status)
  values (
    p_lock_key,
    p_owner_id,
    now() + (p_timeout_seconds || ' seconds')::interval,
    'active'
  )
  on conflict (lock_key) do update
  set
    owner_id = case
      when distributed_mutation_lock.status = 'released' then p_owner_id
      when distributed_mutation_lock.status = 'expired' and distributed_mutation_lock.expires_at < now() then p_owner_id
      when distributed_mutation_lock.owner_id = p_owner_id then p_owner_id
      else distributed_mutation_lock.owner_id
    end,
    token = case
      when distributed_mutation_lock.status = 'released' then gen_random_uuid()
      when distributed_mutation_lock.status = 'expired' and distributed_mutation_lock.expires_at < now() then gen_random_uuid()
      when distributed_mutation_lock.owner_id = p_owner_id then gen_random_uuid()
      else distributed_mutation_lock.token
    end,
    expires_at = case
      when distributed_mutation_lock.owner_id = p_owner_id or distributed_mutation_lock.status in ('released', 'expired') then now() + (p_timeout_seconds || ' seconds')::interval
      else distributed_mutation_lock.expires_at
    end,
    status = case
      when distributed_mutation_lock.status = 'released' then 'active'
      when distributed_mutation_lock.status = 'expired' and distributed_mutation_lock.expires_at < now() then 'active'
      else distributed_mutation_lock.status
    end,
    acquired_at = case
      when distributed_mutation_lock.owner_id = p_owner_id or distributed_mutation_lock.status in ('released', 'expired') then now()
      else distributed_mutation_lock.acquired_at
    end
  where lock_key = p_lock_key
  returning (
    select row_to_json(t) from (
      select
        lock_key,
        owner_id,
        token,
        acquired_at,
        expires_at,
        status,
        (owner_id = p_owner_id) as acquired_by_caller,
        (expires_at < now()) as is_expired
    ) t
  ) into v_result;

  return coalesce(v_result, jsonb_build_object(
    'lock_key', p_lock_key,
    'owner_id', p_owner_id,
    'acquired_by_caller', true,
    'is_expired', false,
    'status', 'active'
  ));
end;
$$;

-- Release lock function (only owner can release)
create or replace function public.release_distributed_lock(
  p_lock_key text,
  p_owner_id text,
  p_token uuid
)
returns boolean
language plpgsql
as $$
begin
  update public.distributed_mutation_lock
  set status = 'released'
  where lock_key = p_lock_key
    and owner_id = p_owner_id
    and token = p_token;

  return found;
end;
$$;
