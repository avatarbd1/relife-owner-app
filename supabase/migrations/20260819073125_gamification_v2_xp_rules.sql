insert into relife.gamification_config (
  organization_id,
  clinic_id,
  department,
  config_key,
  version,
  config_value,
  updated_by
)
select
  relife.default_organization_id(),
  relife.default_clinic_id(),
  'All',
  'xp.rules',
  1,
  '{"rules":[{"event_type":"session_completed","roles":["Therapist","Dentist"],"mode":"per_event","xp":1},{"event_type":"attendance_on_time","roles":["Therapist","Receptionist","Manager","Dentist"],"mode":"per_event","xp":1},{"event_type":"patient_registered","roles":["Receptionist"],"mode":"every_n","n":5,"xp":1},{"event_type":"payment_processed","roles":["Receptionist"],"mode":"every_n","n":10,"xp":1},{"event_type":"appointment_booked","roles":["Receptionist"],"mode":"every_n","n":5,"xp":1}],"notes":"XP is computed server-side from verified immutable events. Every-N rules use lifetime cumulative verified event count per staff, event type and role context; partial progress carries forward."}'::jsonb,
  'system:gamification-v2-xp-rules'
where relife.default_organization_id() is not null
  and relife.default_clinic_id() is not null
on conflict do nothing;
