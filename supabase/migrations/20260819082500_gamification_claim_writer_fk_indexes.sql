create index if not exists reward_redemption_events_tenant_idx
  on relife.reward_redemption_events (organization_id, clinic_id);

create index if not exists reward_redemption_events_redemption_tenant_idx
  on relife.reward_redemption_events (organization_id, clinic_id, redemption_id);
