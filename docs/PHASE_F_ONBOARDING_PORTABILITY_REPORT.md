# Phase F — Onboarding & Portability

Status: implementation candidate for CI/review. Phase G real Clinic #2 activation is intentionally out of scope.

## F1 — Code-free onboarding

- Owner-only `/onboarding` checklist exposes the 11 master-contract onboarding steps.
- Clinic profile onboarding validates the clinic profile and all seven operating-hour rows before any write.
- Canonical tenant-scoped Phase B-D configuration writers remain authoritative; Phase F does not introduce parallel business writers.

## F2 — Import / mapping foundation

- CSV parsing supports quoted fields and rejects malformed headers or column counts.
- Mapping targets are allow-listed per entity and duplicate target mappings fail closed.
- Every row is validated before `canProceed=true`; preview size does not weaken the validation gate.
- The endpoint is explicitly validation-only and performs no mutation. A future mutation executor must reuse canonical tenant-aware writers and is not falsely advertised as complete.

## F3 — Readiness engine

- Activation is `READY_FOR_ACTIVATION` only when every required check is `PASS`.
- Organization/clinic existence, schema reachability and cross-organization conflict checks are gathered by trusted server-side probes.
- Missing evidence is `UNVERIFIED`, never converted to `PASS`.
- The no-Relife-fallback check requires deployment attestation `PHASE_F_TENANT_RUNTIME_ATTESTATION=phase-f-no-relife-fallback-v1`; CI/static guards cover the Phase F active paths.
- Basic finance readiness requires `core.finance_basic` to be present in the active catalog, enabled for the clinic and actively entitled.

## F4 — Export foundations

- Reuses the canonical tenant-aware `/api/export/csv` surface for supported patients, appointments and financial exports.
- The Phase F dry-run reports capability only; it does not query nonexistent parallel tables or claim rollback for a read-only export.
- Unsupported staff/services/reports portability remains explicit instead of being presented as complete.

## F5 — Provisioning dry-run / rollback evidence

- `/api/onboarding/provisioning-dry-run` exposes a deterministic, non-mutating plan.
- Every planned mutating step must have an explicit compensation before the plan is considered reversible.
- In the bounded Phase F plan, activation is the only mutating step; compensation transitions lifecycle back to `ready` and does not delete tenant business rows.

## Tenant and production safety

- Canonical tenant identity remains exact `organization_id + clinic_id` from authenticated tenant context.
- Phase F routes reject mismatched tenant scope and privileged reads remain explicitly composite-scoped.
- No schema migration is added by this phase.
- Production data is not mutated by this implementation work.
- Phase G real Clinic #2 proof is not performed here.

## Verification expectations

Required pull-request verification is the repository's normal full test, lint, type-check/build and policy/metadata CI. Focused Phase F tests exercise fail-closed readiness evidence, full-dataset import validation, cross-tenant guards and provisioning compensation semantics.
