alter table relife.appointments
  add column if not exists request_id text not null default '';

create unique index if not exists appointments_clinic_request_uidx
  on relife.appointments (clinic_id, request_id)
  where request_id <> '';

create index if not exists appointments_clinic_date_status_idx
  on relife.appointments (clinic_id, date, status);

create index if not exists machine_reservations_clinic_date_resource_idx
  on relife.machine_reservations (clinic_id, date, resource_id, status);

create index if not exists treatment_timeline_clinic_appointment_idx
  on relife.treatment_timeline (clinic_id, appointment_id);
