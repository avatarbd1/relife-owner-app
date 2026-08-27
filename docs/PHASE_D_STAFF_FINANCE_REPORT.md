# Phase D — Staff + Finance Report

Base: `origin/main` at `a66d8b38426c4707a767a1866f57b7fbb8358c04`, containing merged Phase C.

## Completed

- Added one tenant-scoped Staff/Finance configuration resolver with explicit failure reasons.
- Connected canonical staff create/update/deactivate to the existing Phase A staff tenant binding, role, and department tables.
- Limited staff settings reads to active provisioning rows for the exact organization and clinic.
- Kept the existing Sheets staff writer and finance ledgers authoritative; no parallel operational writer was introduced.
- Enforced `core.staff`, `core.finance_basic`, `optional.salary`, and `optional.finance_advanced` on the relevant server mutation routes.
- Extended clinic validation through Phase D without claiming onboarding or production activation readiness.

## Isolation and failure behaviour

All configuration functions require explicit `organizationId + clinicId`. Missing, partial, mismatched, inactive, unknown-role, invalid-department, and invalid salary/provider configurations fail closed. The same `clinicId` under another organization does not match. A partial Supabase role/department replacement deactivates the affected binding.

## Authority and migrations

No migration was added. Phase D reuses the existing Phase A/T2-01 staff binding tables and Phase A feature catalog/resolver. Sheets staff and finance authorities remain unchanged. The compatibility dual-write and its compensation limit are recorded in `MIGRATION_AUDIT.md`.

## Verification

The executed `phaseDStaffFinance` tests cover real resolver/readiness functions. Runtime contract checks separately assert route ordering, feature gates, tenant filters, and canonical writer reuse; those checks are labelled contract/shape evidence and are not database execution proof.

Full final test, lint, build, compatibility-ratchet, and CI results are recorded in PR #212 after the exact final head is verified.

## Fixed Relife debt and limits

No fixed Relife identity was added or moved behind a constant. The named ratchet remains 113 occurrences across 28 files. Phase D does not remove the legacy `physio` Sheets routing alias because per-clinic data-source routing and operational cutover require the later onboarding/portability phase.

Production was not touched. No paid Supabase branch or other paid resource was created. Real Supabase Advisors were not run because no free isolated branch was available.

## Deferred

Owner UX, clinic switcher/organization aggregation, onboarding wizard, imports/exports, provisioning rollback/dry-run workflow, production migration, and real Clinic #2 evidence remain Phase E–G. Phase D completion does not claim full multi-clinic productization.
