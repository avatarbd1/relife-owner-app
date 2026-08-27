# Relife Clinic OS tenant foundation

The authoritative product and rollout contract is `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md`.

That master contract governs clinic configuration, feature flags, facility/resources, booking modes, owner access, storage/data ownership, onboarding, readiness, tenant isolation, and commercial rollout. Where historical tenancy notes or older rollout assumptions conflict with the master contract, the master contract wins.

## Target architecture

Relife Clinic OS is one shared configurable multi-tenant codebase and runtime.

Relife is a flagship/reference tenant using the same canonical tenant contract as commercial clinics. Relife-specific workflows must not become universal defaults.

Normal clinic differences — such as clinic type, room count, bed/resource count, services/prices, staff, booking mode, finance options, Chamber, gamification, salary, or other modules — must be represented as data/configuration rather than source-code conditions.

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

## Canonical data/storage direction

- Supabase/Postgres is the target primary operational and configuration store for tenant data.
- Managed Drive/storage owns file/media payloads, with tenant-scoped metadata and authorized access.
- Google Sheets remains a legacy/import/export/reporting compatibility source and is not the canonical realtime database for new commercial clinics.
- One clinic must not require its own Supabase project, Render service, or code branch.

## Required before Clinic #2 is activated

1. Complete DB/privileged-path tenant hardening for the actual runtime architecture; do not assume ordinary RLS protects `service_role`/BYPASSRLS traffic.
2. Resolve active clinic from authenticated membership/context on every tenant-owned request.
3. Pass `organization_id` and `clinic_id` explicitly on every tenant-owned transactional write and query.
4. Enforce both tenant keys in privileged/Edge Function bootstrap/conflict/read/update paths where the schema carries both columns.
5. Replace/widen legacy globally unique business-key constraints where different clinics may reuse local IDs such as patient IDs or Chamber resource IDs.
6. Fix and harden clinic onboarding/readiness validation so it verifies the requested staff membership and every required readiness gate.
7. Make clinic provisioning configuration/data-driven, including staff membership, facility/resources, services/pricing, booking rules, finance configuration, feature flags, and operational data-source/storage mapping. Onboarding a normal clinic must not require source-code conditions.
8. Add deterministic cross-tenant tests proving one clinic cannot read, mutate, reserve, export, fetch media, or audit another clinic's data.
9. Execute a real Clinic #2 isolation and operational smoke using the master onboarding mechanism.
10. Prove repeatability on Clinics #3-#5 without source-code changes for ordinary clinic differences before batching Clinics #6-#20.
11. Keep Finance ledger invariants independent from tenant routing; tenant scope must never change accounting semantics.

## Governing rollout sequence

`Tenant hardening -> multi-clinic constraints -> configuration core -> generic facility/resource model -> configurable booking -> staff/finance configuration -> owner UX -> onboarding/readiness -> real Clinic #2 isolation -> Clinics #3-#5 repeatability -> Clinics #6-#20 commercial rollout`

Performance tuning for materially larger scales is deliberately deferred until the repeatability/commercial-readiness gate is closed unless real evidence requires it earlier.

## Migration source of truth

The SQL in `supabase/migrations/` mirrors migrations applied to the connected Supabase project. New schema changes must be tracked there and verified with appropriate security/performance review and rollback evidence.
