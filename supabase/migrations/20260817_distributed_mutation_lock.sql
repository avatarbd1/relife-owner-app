-- Distributed mutation lock for cross-instance serialization of Google Sheets
-- read-check-write workflows. The table is server infrastructure only.

create table if not exists public.distributed_mutation_lock (
  lock_key text primary key,
  owner_id text not null,
  token uuid not null default pg_catalog.gen_random_uuid(),
  acquired_at timestamp with time zone not null default pg_catalog.now(),
  expires_at timestamp with time zone not null,
  status text not null default 'active' check (status in ('active', 'released')),
  created_at timestamp with time zone not null default pg_catalog.now(),
  constraint lock_key_format check (lock_key ~ '^[a-z0-9:_-]+$'),
  constraint owner_id_not_empty check (owner_id <> ''),
  constraint expires_after_acquired check (expires_at > acquired_at)
);

create index if not exists idx_distributed_mutation_lock_owner_id
  on public.distributed_mutation_lock(owner_id);
create index if not exists idx_distributed_mutation_lock_expires_at
  on public.distributed_mutation_lock(expires_at);
create index if not exists idx_distributed_mutation_lock_status
  on public.distributed_mutation_lock(status);

alter table public.distributed_mutation_lock enable row level security;

-- Remove any permissive policies from an earlier draft of this migration.
drop policy if exists "read_lock_state" on public.distributed_mutation_lock;
drop policy if exists "acquire_lock" on public.distributed_mutation_lock;
drop policy if exists "release_lock_by_owner" on public.distributed_mutation_lock;

-- Direct client access is forbidden. The service role invokes SECURITY DEFINER
-- RPCs instead; service_role also bypasses RLS in Supabase.
revoke all on table public.distributed_mutation_lock from public, anon, authenticated;
grant select, insert, update, delete on table public.distributed_mutation_lock to service_role;

create or replace function public.acquire_distributed_lock(
  p_lock_key text,
  p_owner_id text,
  p_timeout_seconds int default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_timeout_seconds int := greatest(5, least(coalesce(p_timeout_seconds, 120), 600));
  v_result jsonb;
begin
  if p_lock_key is null or p_lock_key !~ '^[a-z0-9:_-]+$' then
    raise exception 'invalid distributed lock key';
  end if;
  if p_owner_id is null or p_owner_id = '' then
    raise exception 'distributed lock owner is required';
  end if;

  insert into public.distributed_mutation_lock (
    lock_key,
    owner_id,
    expires_at,
    status
  ) values (
    p_lock_key,
    p_owner_id,
    pg_catalog.now() + pg_catalog.make_interval(secs => v_timeout_seconds),
    'active'
  )
  on conflict (lock_key) do update
  set owner_id = excluded.owner_id,
      token = pg_catalog.gen_random_uuid(),
      acquired_at = pg_catalog.now(),
      expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => v_timeout_seconds),
      status = 'active'
  where public.distributed_mutation_lock.status = 'released'
     or public.distributed_mutation_lock.expires_at <= pg_catalog.now()
  returning pg_catalog.jsonb_build_object(
    'lock_key', public.distributed_mutation_lock.lock_key,
    'owner_id', public.distributed_mutation_lock.owner_id,
    'token', public.distributed_mutation_lock.token,
    'acquired_at', public.distributed_mutation_lock.acquired_at,
    'expires_at', public.distributed_mutation_lock.expires_at,
    'status', public.distributed_mutation_lock.status,
    'acquired_by_caller', true,
    'is_expired', false
  ) into v_result;

  if v_result is not null then
    return v_result;
  end if;

  select pg_catalog.jsonb_build_object(
    'lock_key', lock_key,
    'owner_id', owner_id,
    'token', token,
    'acquired_at', acquired_at,
    'expires_at', expires_at,
    'status', status,
    'acquired_by_caller', false,
    'is_expired', expires_at <= pg_catalog.now()
  )
  into v_result
  from public.distributed_mutation_lock
  where lock_key = p_lock_key;

  return coalesce(
    v_result,
    pg_catalog.jsonb_build_object(
      'lock_key', p_lock_key,
      'owner_id', null,
      'acquired_by_caller', false,
      'is_expired', false,
      'status', 'unknown'
    )
  );
end;
$$;

create or replace function public.renew_distributed_lock(
  p_lock_key text,
  p_owner_id text,
  p_token uuid,
  p_timeout_seconds int default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_timeout_seconds int := greatest(5, least(coalesce(p_timeout_seconds, 120), 600));
  v_result jsonb;
begin
  update public.distributed_mutation_lock
  set expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => v_timeout_seconds)
  where lock_key = p_lock_key
    and owner_id = p_owner_id
    and token = p_token
    and status = 'active'
    and expires_at > pg_catalog.now()
  returning pg_catalog.jsonb_build_object(
    'lock_key', lock_key,
    'owner_id', owner_id,
    'token', token,
    'expires_at', expires_at,
    'status', status
  ) into v_result;

  if v_result is null then
    return pg_catalog.jsonb_build_object(
      'renewed', false,
      'reason', 'lock missing, expired, released, or token mismatch'
    );
  end if;

  return pg_catalog.jsonb_build_object('renewed', true, 'lock', v_result);
end;
$$;

create or replace function public.release_distributed_lock(
  p_lock_key text,
  p_owner_id text,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.distributed_mutation_lock
  set status = 'released'
  where lock_key = p_lock_key
    and owner_id = p_owner_id
    and token = p_token
    and status = 'active';

  return found;
end;
$$;

create or replace function public.cleanup_expired_locks()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.distributed_mutation_lock
  where expires_at < pg_catalog.now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- grant explicitly so only the server-side service role can manipulate locks.
revoke all on function public.acquire_distributed_lock(text, text, int) from public, anon, authenticated;
revoke all on function public.renew_distributed_lock(text, text, uuid, int) from public, anon, authenticated;
revoke all on function public.release_distributed_lock(text, text, uuid) from public, anon, authenticated;
revoke all on function public.cleanup_expired_locks() from public, anon, authenticated;

grant execute on function public.acquire_distributed_lock(text, text, int) to service_role;
grant execute on function public.renew_distributed_lock(text, text, uuid, int) to service_role;
grant execute on function public.release_distributed_lock(text, text, uuid) to service_role;
grant execute on function public.cleanup_expired_locks() to service_role;
