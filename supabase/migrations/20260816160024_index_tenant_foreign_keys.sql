do $$
declare
  t text;
  tenant_tables text[] := array[
    'appointments',
    'booking_conflicts',
    'chamber_resources',
    'chamber_sessions',
    'chat_messages',
    'equipment_requests',
    'machine_reservations',
    'patient_cache',
    'treatment_plan_cache',
    'treatment_timeline'
  ];
begin
  foreach t in array tenant_tables loop
    execute format(
      'create index if not exists %I on relife.%I (organization_id, clinic_id)',
      t || '_tenant_idx',
      t
    );
  end loop;
end
$$;

create index if not exists machine_reservations_resource_idx
  on relife.machine_reservations (resource_id);
