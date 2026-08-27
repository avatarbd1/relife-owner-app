# Clinic Owner Self-Service Setup

Status: implementation slice for post-Phase-H commercial onboarding UX, including import and activation handoff closure.

## Goal

A tenant Clinic Owner should configure ordinary clinic differences from the Owner App instead of requiring source-code edits or direct database/API work. Platform release authority remains separate.

Primary UI: `/onboarding/setup`.

## Authority model

These identities are deliberately different:

- **Clinic Owner** — tenant-scoped browser role for one authorized clinic. Can configure that clinic through canonical settings paths.
- **Platform Operator** — out-of-band product/release authority used for commercial provisioning, release evidence, import review, and final activation. It is not a browser `WebRole` and is not inferred from Clinic Owner.
- **System Admin** — existing browser role with its existing settings-only policy. It is not the Platform Operator role and gains no implicit clinic-owner, import, entitlement, or activation authority.
- **service_role** — server/database execution authority for privileged provisioning/readiness-record/activation RPCs. Credentials are never exposed to the browser.

The same human may legitimately operate in more than one capacity (for example, Platform Operator plus Clinic Owner of Relife), but each action must still cross the authority boundary required for that action. Possessing tenant `Owner` does not grant platform activation authority.

## Clinic Owner-configurable surfaces

- clinic profile and seven-day operating hours
- room/resource bulk setup or no-facility mode
- simple, capacity, or specific-resource booking configuration
- services, prices, duration, and department
- staff and roles through the existing canonical staff-access surface
- finance through the existing entitled finance surface
- enable/disable feature flags that are already commercially entitled
- CSV mapping and full-dataset validation preview
- fail-closed readiness validation

## Existing-data import handoff

`POST /api/onboarding/import` remains non-mutating. After mapping validation and full-dataset analysis it returns a tenant-bound handoff receipt containing:

- entity type and exact organization + clinic scope
- total/valid/invalid row counts
- SHA-256 digest of the submitted entity/content/mapping payload so platform review can bind evidence to the exact validated input without echoing the CSV back
- `READY_FOR_PLATFORM_IMPORT_REVIEW` only when every row is valid
- `mutationPerformed: false` and `clinicOwnerMayExecuteImport: false`

This closes the self-service validation-to-platform-review handoff without silently routing mapped data into an incompatible or partially reviewed writer. A future mutation executor must be separately reviewed against the canonical writer for each entity and must preserve tenant, department, idempotency, audit, and rollback rules.

## Activation handoff

Clinic readiness and platform activation are intentionally two different gates.

1. Clinic Owner runs `/api/setup/clinic-validation` for the current authenticated tenant.
2. If the readiness engine reaches `READY_FOR_ACTIVATION`, the browser response describes the owner-side state as `READY_FOR_PLATFORM_VERIFICATION`; it does **not** claim that the clinic is activated or platform-authorized.
3. Platform Operator independently verifies the release and records readiness evidence for the exact 40-character release SHA through service-role-only `relife.record_clinic_readiness_v1(...)`.
4. Only then may the platform execute service-role-only `relife.activate_clinic_v1(...)` for the same organization, clinic, and release SHA.
5. The activation RPC itself rechecks verified evidence, active owner membership, clinic settings, seven operating-hour rows, booking configuration, active service, and tenant-binding consistency before changing lifecycle to `active`.

No browser route records privileged release evidence or calls the activation RPC.

## Boundaries intentionally preserved

- Organization creation/provisioning remains platform authority.
- Commercial plan and entitlement assignment remain Platform Operator authority.
- Clinic Owner feature selection may not create or extend an entitlement.
- Existing-data import remains validation/handoff-only until a separately reviewed canonical mutation executor exists.
- Final clinic activation remains a privileged readiness-gated platform operation; service-role credentials are never exposed to the browser.
- Existing clinic, facility, service, staff, finance, import, and readiness canonical paths are reused rather than duplicated.

## Rollback

Revert this UX/handoff slice. It adds no migration and changes no production schema. Handoff receipts are response metadata only and perform no writes. Existing tenant configuration rows written by a Clinic Owner through canonical settings APIs remain valid tenant data and do not require destructive rollback.
