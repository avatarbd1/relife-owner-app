update relife.gamification_config
set status = 'archived', effective_until = now(), updated_at = now(), updated_by = 'system:v2-role-targets'
where clinic_id = relife.default_clinic_id()
  and department = 'All'
  and status = 'active'
  and config_key in ('score.role.therapist','score.role.receptionist','score.role.manager');

insert into relife.gamification_config (
  organization_id, clinic_id, department, config_key, version, config_value, updated_by
)
select relife.default_organization_id(), relife.default_clinic_id(), 'All', v.config_key, 2, v.config_value, 'system:v2-role-targets'
from (values
  ('score.role.therapist', '{"enabled":true,"scale":100,"targets":{"sessions_per_week":8,"attendance_days_per_week":5},"weights":{"productivity":0.40,"attendance":0.20,"documentation":0.15,"quality":0.15,"reliability":0.10}}'::jsonb),
  ('score.role.receptionist', '{"enabled":true,"scale":100,"targets":{"workflow_transactions_per_week":125,"attendance_days_per_week":5},"weights":{"workflow":0.40,"cash_accuracy":0.25,"appointment_accuracy":0.15,"attendance":0.10,"error_control":0.10},"registration_phone_required_for_score":false}'::jsonb),
  ('score.role.manager', '{"enabled":true,"scale":100,"targets":{"coordination_tasks_per_week":10,"attendance_days_per_week":5},"weights":{"coordination":0.30,"incidents":0.25,"schedule":0.20,"staff_satisfaction":0.15,"attendance":0.10}}'::jsonb)
) as v(config_key, config_value)
where relife.default_organization_id() is not null
  and relife.default_clinic_id() is not null;
