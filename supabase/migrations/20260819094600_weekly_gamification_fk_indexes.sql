create index if not exists weekly_performance_finalization_tenant_idx
  on relife.weekly_performance (organization_id, clinic_id, finalization_id)
  where finalization_id is not null;

create index if not exists reward_credit_ledger_weekly_performance_tenant_idx
  on relife.reward_credit_ledger (organization_id, clinic_id, weekly_performance_id)
  where weekly_performance_id is not null;
