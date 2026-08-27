do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('relife.provision_clinic_v1(jsonb)'::regprocedure)
    into function_sql;
  function_sql := replace(
    function_sql,
    'requires_provider=excluded.provider_required',
    'requires_provider=excluded.requires_provider'
  );
  execute function_sql;
end
$$;
