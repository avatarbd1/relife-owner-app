create table if not exists relife.finance_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references relife.organizations(id),
  clinic_id uuid not null references relife.clinics(id),
  department text not null check (department in ('Physio','Dental')),
  entity_type text not null check (
    entity_type in ('Payment','Expense','CashMovement','SalaryPayment')
  ),
  entity_id text not null,
  status text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  actor_id text not null,
  patient_id text not null default '',
  staff_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_operations_entity_uidx
    unique (clinic_id, entity_type, entity_id)
);

create index if not exists finance_operations_clinic_department_idx
  on relife.finance_operations (clinic_id, department, updated_at desc);
create index if not exists finance_operations_clinic_status_idx
  on relife.finance_operations (clinic_id, status, updated_at desc);
create index if not exists finance_operations_patient_idx
  on relife.finance_operations (clinic_id, patient_id, updated_at desc)
  where patient_id <> '';
create index if not exists finance_operations_staff_idx
  on relife.finance_operations (clinic_id, staff_id, updated_at desc)
  where staff_id <> '';

alter table relife.finance_operations enable row level security;
revoke all on table relife.finance_operations from anon, authenticated;
