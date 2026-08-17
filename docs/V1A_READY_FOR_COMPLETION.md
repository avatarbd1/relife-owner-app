# V1-A Completion Gate

## Current State

V1-A is no longer a planning document. The implementation is present on PR #92 and is awaiting final production-gate approval.

Completed scope:
- Expense audit atomicity
- Cash Movement audit atomicity
- Salary audit atomicity
- Finance mutation lock wrappers
- Supabase/Postgres distributed lease locking
- Fail-closed production lock mode
- Real lock/concurrency regression tests
- Migration security hardening

## GitHub Quality Gate

The latest verified V1-A branch run passes:
- PR impact/user-flow gate
- lint
- domain tests
- build

Total tests: 134 PASS.

The concurrency suite imports and executes the production lock core; it does not contain a copied lock implementation or placeholder `ok(true)` acceptance assertions.

## Production Preconditions

V1-A must not be merged until the deployment order is safe.

### 1. Supabase schema first
Apply:

`supabase/migrations/20260817_distributed_mutation_lock.sql`

The migration is additive and creates the infrastructure lock table and server-role-only RPCs. Existing finance data is not migrated or rewritten.

### 2. Render environment
Confirm the production service has:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Default lock mode is `required`. Missing distributed-lock configuration therefore fails closed instead of silently executing finance writes without cross-instance protection.

### 3. Merge only after the preconditions
After schema/env verification, merge PR #92. Render tracks `main` with auto-deploy, so merging before the migration/configuration is ready can make finance mutations fail closed until the RPCs are available.

## Rollback

Use a normal Git revert of the merged V1-A change. Do not reset shared `main`.

The Supabase lock table/functions are additive infrastructure; if the application is reverted, they can remain unused safely. A separate schema migration can remove them later if desired. Do not destructively roll back production finance records.

## Deferred to Later V1 Gates

V1-B:
- Role/department authority cleanup
- Patient Hub and payment/appointment/clinical actions
- patient mutation concurrency

V1-C:
- Appointment/Chamber canonical authority
- booking time vs real treatment runtime
- bed/therapist/machine/gender conflict logic

V1-D:
- duplicate/legacy product surfaces
- chat/notification lifecycle
- PWA/mobile final hardening
- final role × department × action regression matrix

## Final V1-A Decision

Code review status: ready for final production precondition check.

Do not merge or deploy until Supabase migration + Render environment are confirmed.
