# Relife Owner App — Builder context

Cross-repo AI/team/process/release-control rules are centralized in `avatarbd1/multi-ai-commander` under `docs/RELIFE_PROGRAM_CONTROL.md`.

## Product identity
- `relife-owner-app` is the primary Web/PWA product runtime.
- `relife-clinic-os` is legacy Telegram/support runtime during migration.
- Product direction is multi-tenant with strict clinic/department isolation.
- Current product/runtime truth comes from current code, product docs, active issues/PRs, and verified runtime evidence.

## Product-local invariants
- Reuse existing canonical readers/writers/domain services; no duplicate business engine.
- Preserve department/tenant isolation and fail closed on missing/ambiguous scope.
- Preserve current Google Sheets/Supabase authority unless an Owner-approved product issue changes it.
- Finance truth remains separated: billed services, collections, outstanding, expenses, salary, and cash custody are not interchangeable.
- Internal cash handover is custody movement, not revenue or expense.
- Booking and live treatment operation remain separate domains.
- Critical writes require authorization, durable locking/idempotency where applicable, and audit evidence.
- Schema/RLS, authority, migration/cutover and tenancy changes require current product evidence and rollback-aware review.

## Product documentation to read when relevant
- `ARCHITECTURE.md`
- `MIGRATION_AUDIT.md`
- `TENANCY.md`
- `docs/CANONICAL_PATH_REGISTRY.md`
- `docs/MULTITENANT_KERNEL_V1.md`
- `docs/TENANT1_CUTOVER_AUDIT.md`
- domain-specific active issue/PR

## Builder boundary
Implement only the approved product scope. Do not redefine business strategy, create a second writer/permission model, claim live verification from local tests, or expose credentials/production data.
