-- Resolve canonical staff identity through the exposed public RPC surface.
-- The function remains SECURITY INVOKER: only the server-side service_role has
-- table privileges, and browser roles cannot execute it.

create or replace function public.resolve_canonical_staff_identity_v1(
  p_staff_id text,
  p_organization_id uuid default null,
  p_clinic_id uuid default null,
  p_allow_setup boolean default false
)
returns table (
  staff_id text,
  role_codes text[],
  department_ids text[]
)
language sql
stable
security invoker
set search_path = pg_catalog, public, relife
as $function$
  with eligible as (
    select b.id, b.staff_id
    from relife.staff_tenant_bindings b
    join relife.clinics c
      on c.id = b.clinic_id
     and c.organization_id = b.organization_id
    where b.staff_id = btrim(p_staff_id)
      and b.status = 'active'
      and (p_organization_id is null or b.organization_id = p_organization_id)
      and (p_clinic_id is null or b.clinic_id = p_clinic_id)
      and (c.status = 'active' or (p_allow_setup and c.status = 'setup'))
      and exists (
        select 1 from relife.staff_tenant_roles r where r.binding_id = b.id
      )
      and exists (
        select 1 from relife.staff_tenant_departments d where d.binding_id = b.id
      )
  ),
  single_binding as (
    select (array_agg(id order by id))[1] as id
    from eligible
    having count(*) = 1
  )
  select
    e.staff_id,
    array(
      select distinct r.role_code
      from relife.staff_tenant_roles r
      where r.binding_id = e.id
      order by r.role_code
    ),
    array(
      select distinct d.department_id
      from relife.staff_tenant_departments d
      where d.binding_id = e.id
      order by d.department_id
    )
  from eligible e
  join single_binding s on s.id = e.id;
$function$;

revoke all on function public.resolve_canonical_staff_identity_v1(text, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_canonical_staff_identity_v1(text, uuid, uuid, boolean)
  to service_role;

comment on function public.resolve_canonical_staff_identity_v1(text, uuid, uuid, boolean) is
  'Server-only canonical identity lookup. Fails closed unless exactly one eligible tenant binding has roles and departments.';
