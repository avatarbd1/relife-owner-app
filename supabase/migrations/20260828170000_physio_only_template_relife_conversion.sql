begin;

-- Physio-only SaaS decision (Owner-approved): the platform offers exactly
-- one clinic template (Physiotherapy). Relife converts from its historical
-- dual Physio+Dental compatibility identity to a single-department Physio
-- tenant, exactly like every other clinic. Dental is discontinued as a
-- business line: existing RELIFE-DENTAL Sheets-ledger data remains an
-- untouched, read-only historical archive; no new Dental activity is
-- permitted anywhere going forward (enforced separately at the application
-- layer in the platform provisioning, settings, and self-service
-- clinic-profile/services/facility paths).

-- 1. Relife's own clinic profile becomes physiotherapy, exactly like any
--    other tenant. Idempotent and additive: Relife may not yet have a
--    clinic_settings row, since that table postdates Relife's original
--    tenant bootstrap.
insert into relife.clinic_settings (organization_id, clinic_id, clinic_type, updated_by)
select o.id, c.id, 'physiotherapy', 'migration:physio_only_template'
from relife.organizations o
join relife.clinics c on c.organization_id = o.id
where o.slug = 'relife' and c.slug = 'amtali-main'
on conflict (organization_id, clinic_id) do update
  set clinic_type = 'physiotherapy',
      updated_by = 'migration:physio_only_template',
      updated_at = now();

-- 2. Archive (never delete) Relife's Dental-department services/resources.
--    Historical rows stay intact for read-only audit/export; they simply
--    stop being live/bookable, and carry no scope/UI/permission connection
--    to the converted Physio tenant.
update relife.clinic_services sv
set is_active = false, updated_at = now()
from relife.organizations o, relife.clinics c
where o.slug = 'relife' and c.slug = 'amtali-main'
  and sv.organization_id = o.id and sv.clinic_id = c.id
  and sv.department = 'Dental';

update relife.clinic_resources rs
set is_active = false, is_bookable = false, updated_at = now()
from relife.organizations o, relife.clinics c
where o.slug = 'relife' and c.slug = 'amtali-main'
  and rs.organization_id = o.id and rs.clinic_id = c.id
  and rs.resource_type = 'DENTAL_CHAIR';

-- 3. Narrow the clinic_type check constraint. No clinic — Relife included,
--    already converted above — may carry a type other than physiotherapy.
--    Step 1 must run first so Relife's own row satisfies this before it is
--    added.
alter table relife.clinic_settings drop constraint if exists clinic_settings_clinic_type_check;
alter table relife.clinic_settings
  add constraint clinic_settings_clinic_type_check check (clinic_type in ('physiotherapy'));

commit;
