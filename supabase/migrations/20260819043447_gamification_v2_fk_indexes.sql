create index if not exists xp_ledger_tenant_idx
  on relife.xp_ledger (organization_id, clinic_id);
create index if not exists xp_ledger_event_tenant_idx
  on relife.xp_ledger (organization_id, clinic_id, performance_event_id);
create index if not exists weekly_performance_tenant_idx
  on relife.weekly_performance (organization_id, clinic_id);
create index if not exists reward_credit_ledger_tenant_idx
  on relife.reward_credit_ledger (organization_id, clinic_id);
create index if not exists reward_credit_ledger_redemption_tenant_idx
  on relife.reward_credit_ledger (organization_id, clinic_id, redemption_id);
create index if not exists reward_credit_ledger_related_entry_idx
  on relife.reward_credit_ledger (related_entry_id);
create index if not exists monthly_performance_bonuses_tenant_idx
  on relife.monthly_performance_bonuses (organization_id, clinic_id);
create index if not exists team_targets_tenant_idx
  on relife.team_targets (organization_id, clinic_id);
create index if not exists gamification_config_tenant_idx
  on relife.gamification_config (organization_id, clinic_id);
