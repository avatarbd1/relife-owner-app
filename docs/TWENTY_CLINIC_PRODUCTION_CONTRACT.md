# Relife Owner App — Canonical 20-Clinic Production Contract

Status: OWNER-SELECTED PRODUCT DIRECTION

This document is the authoritative local product contract for preparing Relife Owner App for the first 20 production clinics. It overrides stale single-clinic assumptions in historical notes, branches, comments, seed fixtures, and compatibility code.

## Product target

- One multi-tenant codebase.
- One shared application runtime; do not create one Render service, Supabase project, or code branch per clinic.
- First commercial rollout target: 20 Physio clinics.
- Relife Dental remains an internal/pilot clinical module and may be used as a second-clinic isolation test, but Dental feature expansion does not block the first 20 Physio-clinic rollout.
- Relife is not a permanent legacy exception. Existing Relife data must be migrated/normalized into the same canonical tenant contract used by every new clinic.

## Canonical identity model

Runtime business logic must use explicit `organizationId + clinicId` resolved from authenticated tenant membership/context.

- `organization_id` identifies the organization/tenant boundary.
- `clinic_id` identifies the clinic boundary inside that organization.
- Department (`Physio`, `Dental`, etc.) is authorization/business scope, not a substitute for `clinic_id`.
- `RELIFE-PHYSIO` / `RELIFE-DENTAL` may exist only where they are verified legacy Sheets ledger/department identifiers. They must not be treated as universal runtime tenant defaults or new-clinic primary keys.

## No-special-case rule

Do not add new production helpers, routes, readers, writers, dashboards, or admin views that silently inject `RELIFE`, `RELIFE-PHYSIO`, `RELIFE-DENTAL`, `amtali-main`, or any fixed clinic identity.

If legacy Relife data requires compatibility:

1. keep compatibility at an explicit migration/adapter boundary;
2. make the boundary named and auditable;
3. never let authenticated tenant runtime paths depend on the compatibility default;
4. provide a removal/migration path;
5. do not create a new per-clinic conditional branch.

Seed/test fixtures may use fixed IDs only when clearly test-only and when production code cannot inherit those defaults.

## Runtime isolation invariant

Every tenant-owned read/write must either:

- receive explicit `organizationId + clinicId` from the canonical tenant context; or
- operate in a deliberately documented system-admin/control boundary with independent authorization and audit semantics.

For tenant-owned data, missing, blank, ambiguous, or mismatched tenant identity fails closed.

Department access checks are additive to tenant checks; department scope never replaces tenant isolation.

## First-20 rollout gates

### T4 — DB / privileged-path tenant hardening
Complete independent database/privileged-path protection required for the actual runtime architecture. Do not claim ordinary RLS protects `service_role`/BYPASSRLS traffic. Every active privileged tenant path must enforce the dual tenant key before Clinic #2 activation.

### T5 — Multi-clinic schema constraints
Audit and migrate globally unique business keys, foreign keys, indexes, and constraints so two clinics can safely reuse clinic-local identifiers. Prefer explicit composite tenant keys where required. Every migration needs deterministic tests and rollback.

### Provisioning — code-free clinic onboarding
A new clinic must be provisioned through data/configuration, not source-code edits. The provisioning contract must cover at least:

- organization/clinic records;
- staff membership and role/department access;
- clinic-specific operational data-source mapping;
- required Sheets/workbook/schema readiness;
- required storage/media configuration;
- validation and rollback/dry-run evidence.

### T6 — real Clinic #2 isolation proof
Clinic #2 is the first production-style gate. Prove Clinic A cannot read, write, export, reserve, operate, audit, or fetch media belonging to Clinic B, while explicitly authorized Owner/System-Admin behavior still works.

### Repeatability gate
After Clinic #2 passes, onboard Clinics #3–#5 using the same mechanism without code changes. Only then batch Clinics #6–#20.

## Readiness definition

The system is `20-CLINIC READY` only when:

- T4 is closed on current main;
- T5 constraints are applied and rollback-tested;
- clinic onboarding is generic and configuration-driven;
- staff membership is deterministic and fail-closed;
- data-source/storage mapping is clinic-aware;
- Clinic #2 real isolation smoke passes;
- Clinics #3–#5 prove repeatable onboarding without code changes;
- the same runbook can provision Clinics #6–#20;
- no active production path relies on an undocumented Relife-only tenant fallback.

## Current verified blockers / audit targets

The following are known blockers or review targets as of the contract creation base (`82db274c`):

1. T4 is still active and not closed.
2. T5 multi-clinic key/constraint work is not complete.
3. `app/api/setup/clinic-validation/route.ts` does not reliably prove the requested staff member owns the active membership: the helper receives `staffId` but the current query only checks whether any active clinic membership exists.
4. The same clinic-validation route can compute `isReady` without requiring all advertised readiness checks, including `crossTenantIsolationVerified` and `explicitTenantParametersInWriters`.
5. Compatibility/admin finance helpers introduced during pre-T4 hardening inject fixed Relife tenant IDs (`getCashMovementsForAdminView`, `getScopedCashPositionForAdminView`). These are not acceptable as the long-term multi-clinic admin model and must be replaced by explicit tenant-aware/system-admin aggregation semantics.
6. Historical tenant progress documentation contains stale/contradictory intermediate status and must not override current main or this contract.

These findings are not permission to make unrelated rewrites. Fix them in bounded reviewed slices against current main.

## Out of scope until first 20 clinics are ready

- 50/100-clinic performance tuning;
- broad Dental feature expansion;
- unrelated SMS/Undo/backlog work;
- speculative infrastructure rewrites;
- one-database-per-clinic or one-service-per-clinic architecture without a new Owner decision.
