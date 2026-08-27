alter table relife.appointments
  add column if not exists updated_by text not null default '';

update relife.appointments
set updated_by = created_by
where updated_by = '' and created_by <> '';
