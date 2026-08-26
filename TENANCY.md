# Relife tenant foundation

The target architecture is one shared multi-tenant codebase prepared for the first 20 production Physio clinics. Relife is the first organization/tenant to migrate onto that same canonical contract; it is not a permanent single-clinic exception.

The detailed rollout contract is `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md`.

## Current compatibility state

- Current production compatibility identity is Organization `relife`, Clinic `amtali-main`.
- Existing Chamber rows carry non-null `organization_id` and `clinic_id`.
- Historical server-side/default identifiers may still exist at legacy compatibility boundaries and must be removed or normalized before multi-clinic activation.
- `RELIFE-PHYSIO` and `RELIFE-DENTAL` are verified legacy Sheets ledger/department identities; they are not universal Supabase tenant primary keys and must not be introduced as new runtime tenant defaults.
- Department (`Physio`, `Dental`, etc.) is separate from clinic identity. Department authorization never replaces `organization_id + clinic_id` isolation.
- The `relife` schema remains private to current server-side database paths unless/until an approved authenticated-client cutover grants narrower access.

## Canonical runtime tenant rule

Every tenant-owned runtime read/write must use explicit `organization_id` and `clinic_id` resolved from the authenticated tenant context or membership boundary. Missing, blank, ambiguous, or mismatched tenant identity fails closed.

Do not create production helpers or admin views that silently inject a fixed Relife clinic. If legacy data needs compatibility, keep it in a named migration/adapter boundary with an explicit removal path.

## Required before Clinic #2 is activated

1. Complete T4 DB/privileged-path tenant hardening for the actual runtime architecture; do not assume ordinary RLS protects `service_role`/BYPASSRLS traffic.
2. Resolve active clinic from authenticated membership/context on every tenant-owned request.
3. Pass `organization_id` and `clinic_id` explicitly on every tenant-owned transactional write and query.
4. Enforce both tenant keys in Edge Function bootstrap/conflict/read/update paths where the schema carries both columns.
5. Complete T5: replace/widen legacy globally unique business-key constraints where different clinics may reuse local IDs such as patient IDs or Chamber resource IDs.
6. Fix and harden clinic onboarding/readiness validation so it verifies the requested staff membership and every required readiness gate.
7. Make clinic provisioning configuration/data-driven, including staff membership and operational data-source/storage mapping; onboarding a clinic must not require source-code conditions.
8. Add deterministic cross-tenant tests proving one clinic cannot read, mutate, reserve, export, fetch media, or audit another clinic's data.
9. Execute a real Clinic #2 isolation smoke, then prove repeatability on Clinics #3–#5 before batching Clinics #6–#20.
10. Keep Finance ledger invariants independent from tenant routing; tenant scope must never change accounting semantics.

## First-20 rollout sequence

`T4 -> onboarding/readiness hardening -> T5 -> generic provisioning -> Clinic #2 real isolation -> Clinics #3-#5 repeatability -> Clinics #6-#20 rollout`

50/100-clinic performance tuning is deliberately out of scope until the first-20 gate is closed.

## Migration source of truth

The SQL in `supabase/migrations/` mirrors migrations applied to the connected Supabase project. New schema changes must be tracked there and verified with appropriate security/performance review and rollback evidence.
