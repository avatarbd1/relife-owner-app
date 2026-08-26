# 20-Clinic Readiness — Verified Gap Register

This register is intentionally limited to blockers for the first 20 production clinics. It is not a general backlog.

## P0 — blocks Clinic #2 activation

### G1 — T4 privileged DB/Edge tenant hardening incomplete
Status: ACTIVE

Finish the current T4 work and prove every active privileged tenant path binds both `organization_id` and `clinic_id` or uses an independently reviewed equivalent DB-side tenant guard. Ordinary RLS is not counted as protection for `service_role`/BYPASSRLS traffic.

### G2 — clinic readiness validator can report false readiness
Status: VERIFIED ON BASE `82db274c`

`app/api/setup/clinic-validation/route.ts` has two verified defects:

- `checkStaffMembership(clinicId, staffId)` receives `staffId` but does not filter the membership query by that requested staff/user identity; it only proves that some active membership exists in the clinic.
- `isReady` does not require all advertised readiness checks. In particular the current output fields `crossTenantIsolationVerified` and `explicitTenantParametersInWriters` are not required by the final readiness expression.

Fix must fail closed and must not manufacture readiness evidence.

### G3 — fixed Relife admin/compatibility finance helpers violate the target runtime model
Status: VERIFIED ON BASE `82db274c`

Pre-T4 hardening introduced compatibility helpers such as:

- `getCashMovementsForAdminView()` -> fixed `RELIFE / RELIFE-PHYSIO`
- `getScopedCashPositionForAdminView()` -> fixed `RELIFE` plus department-derived fixed clinic IDs

These helpers protect strict tenant-aware APIs from missing parameters, but they are not a valid long-term multi-clinic admin model. Replace them with explicit tenant-aware calls or an independently authorized multi-clinic aggregation boundary. Do not extend this pattern to other domains.

## P1 — blocks first-20 rollout

### G4 — T5 clinic-scoped business-key constraints incomplete
Status: OPEN

Audit unique keys, foreign keys and indexes for clinic-local identifiers (patient IDs, appointment/business keys, Chamber resources/reservations, request/idempotency keys where appropriate). Apply deterministic migrations and rollback tests before Clinic #2 activation.

### G5 — generic clinic provisioning not yet proven
Status: NOT VERIFIED COMPLETE

A clinic must be addable without source-code edits. Provisioning must create/validate the canonical clinic record, staff membership, role/department scope, operational data-source mapping, required workbook/schema/storage readiness, and rollback/dry-run evidence.

### G6 — per-clinic Sheets/storage routing not yet proven for 20 clinics
Status: NOT VERIFIED COMPLETE

Current Relife Physio/Dental Sheets identities are legacy ledger/department identities. Audit and implement the configuration-driven mapping needed so new clinics do not require hardcoded environment-variable branches or source edits.

### G7 — real Clinic #2 isolation evidence missing
Status: OPEN

Automated tests are necessary but not sufficient. Activate one controlled second clinic only after G1-G6. Prove cross-clinic denial for patient, appointment, finance, clinical/chamber, staff, export/report/media and audit flows, with explicitly authorized Owner/System-Admin behavior tested separately.

### G8 — repeatable onboarding evidence missing
Status: OPEN

After Clinic #2 passes, add Clinics #3-#5 with exactly the same provisioning mechanism and no code changes. Only then batch Clinics #6-#20.

## Non-blocking / deferred

Until the first-20 gate closes, do not expand scope for 50/100-clinic tuning, broad Dental feature expansion, unrelated SMS/Undo work, or speculative infrastructure rewrites.
