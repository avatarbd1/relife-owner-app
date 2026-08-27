begin;

alter table relife.finance_operations
  add constraint finance_operations_tenant_fk
  foreign key (organization_id, clinic_id)
  references relife.clinics (organization_id, id)
  on delete restrict
  not valid;

alter table relife.finance_operations
  validate constraint finance_operations_tenant_fk;

commit;
