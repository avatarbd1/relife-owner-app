begin;

-- The staff-session tenant resolver requires exactly one active default binding
-- when a session has not yet selected a clinic explicitly. Canonical clinic
-- provisioning and Platform Owner reassignment historically wrote
-- is_default=false, which left a newly provisioned single-clinic owner unable
-- to resolve their tenant after activation. Keep the invariant at the table
-- boundary so every writer gets the same behavior without a parallel identity
-- path.
create or replace function relife.enforce_staff_default_tenant_binding()
returns trigger
language plpgsql
set search_path = relife, pg_catalog
as $$
begin
  if new.status <> 'active' or new.is_default = true then
    return new;
  end if;

  -- A staff member who already has a different active default keeps it. This
  -- preserves multi-clinic behavior: additional bindings stay non-default and
  -- require an explicit clinic selection when appropriate.
  if exists (
    select 1
    from relife.staff_tenant_bindings existing
    where existing.staff_id = new.staff_id
      and existing.status = 'active'
      and existing.is_default = true
      and (
        existing.organization_id <> new.organization_id
        or existing.clinic_id <> new.clinic_id
      )
  ) then
    return new;
  end if;

  -- No other active default exists. The first/single active binding is the
  -- deterministic implicit tenant for first login. This also prevents an
  -- idempotent owner upsert from clearing its only default flag.
  new.is_default := true;
  return new;
end;
$$;

revoke all on function relife.enforce_staff_default_tenant_binding()
  from public, anon, authenticated;

drop trigger if exists staff_tenant_bindings_default_guard
  on relife.staff_tenant_bindings;
create trigger staff_tenant_bindings_default_guard
before insert or update of status, is_default, staff_id
on relife.staff_tenant_bindings
for each row
execute function relife.enforce_staff_default_tenant_binding();

comment on function relife.enforce_staff_default_tenant_binding() is
  'Keeps the first/single active staff tenant binding as the implicit default while preserving an existing default for multi-clinic staff.';

-- Bounded repair for already-provisioned identities. Promote only staff IDs
-- with exactly one active binding and no active default. Do not choose between
-- multiple active clinics here; ambiguous multi-clinic state remains
-- fail-closed for explicit review/selection.
with single_active_without_default as (
  select staff_id
  from relife.staff_tenant_bindings
  where status = 'active'
  group by staff_id
  having count(*) = 1
     and count(*) filter (where is_default = true) = 0
)
update relife.staff_tenant_bindings binding
set is_default = true,
    updated_at = now()
from single_active_without_default candidate
where binding.staff_id = candidate.staff_id
  and binding.status = 'active'
  and binding.is_default = false;

-- Fail closed if the bounded repair could not establish the invariant for a
-- single-active-binding identity. The existing partial unique index continues
-- to prevent more than one active default for the same staff ID.
do $$
begin
  if exists (
    select 1
    from relife.staff_tenant_bindings
    where status = 'active'
    group by staff_id
    having count(*) = 1
       and count(*) filter (where is_default = true) <> 1
  ) then
    raise exception 'STAFF_SINGLE_TENANT_DEFAULT_REPAIR_FAILED';
  end if;
end
$$;

commit;
