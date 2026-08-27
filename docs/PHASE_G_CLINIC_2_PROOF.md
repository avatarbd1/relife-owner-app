# Phase G — Real Clinic #2 Proof

Date: 2026-08-28 (Asia/Dhaka)

## Scope

Phase G proves that the Phase A–F multi-tenant/configuration mechanism can provision and activate a second clinic without a clinic-specific source-code branch. The proof tenant was created through `relife.provision_clinic_v1(jsonb)`, not by direct clinic-specific inserts.

## Proof tenant

- Organization: `Phase G Proof Organization`
- Organization ID: `7a8cf79b-1182-4e19-8720-300f3686fdcc`
- Clinic: `Phase G Proof Clinic`
- Clinic ID: `80234491-e7f5-46b6-9f4a-dca0f7c7b163`
- Lifecycle: provisioned as `setup`, then activated only after readiness evidence was recorded.
- Activation evidence release: `879196842a5c43c822e7ede05ef0362d02e58313`

## Production evidence

The following production checks passed before activation:

- one active Owner membership for the exact organization + clinic;
- one clinic settings row;
- seven operating-hour rows;
- one active service;
- one booking configuration row;
- eight enabled feature flags and eight active entitlements;
- `core.finance_basic` actively entitled;
- staff tenant-binding mismatch count: `0`;
- finance operation tenant mismatch count: `0`.

The activation gate was negatively tested with a release SHA that had no verified readiness record. `activate_clinic_v1` rejected that attempt with `CLINIC_ACTIVATION_BLOCKED` before the verified activation was performed.

## Core operational smoke

A transaction-scoped production smoke exercised the second tenant's canonical patient, appointment, and finance storage paths:

1. inserted a Clinic #2 patient-cache row with the exact composite tenant;
2. inserted a Clinic #2 appointment with the exact composite tenant;
3. inserted a Clinic #2 finance operation with the exact composite tenant;
4. verified all three were visible under the exact organization + clinic pair;
5. verified all three were absent under the Relife organization paired with Clinic #2;
6. verified a mismatched finance organization + clinic write was rejected by the composite foreign key;
7. rolled the transaction back.

Post-smoke verification confirmed zero smoke patient, appointment, or finance rows persisted.

## Tenant boundary hardening found during proof

Phase G discovered that `relife.finance_operations` previously had separate organization and clinic foreign keys rather than a composite tenant foreign key. Existing mismatch count was zero, but the schema could structurally accept an invalid cross-tenant pair. Migration `20260828013000_phase_g_finance_composite_tenant_fk.sql` closes that gap and validates existing rows.

`relife.patient_cache` and `relife.appointments` already enforce `(organization_id, clinic_id) -> relife.clinics(organization_id, id)`.

## Legacy Relife compatibility

The legacy Sheets compatibility bridge in `lib/webos/reception.ts` is explicitly bounded to organization slug `relife` and clinic slug `amtali-main`. For every other tenant, patient matching is exact `organization_id + clinic_id`. Phase G adds an executable regression test for that boundary.

## Provisioning/activation authority

The Phase G functions are revoked from `public`, `anon`, and `authenticated`, and granted only to `service_role`:

- `relife.provision_clinic_v1(jsonb)`
- `relife.record_clinic_readiness_v1(...)`
- `relife.activate_clinic_v1(...)`

Provisioning stops at `setup`. Activation requires a verified readiness evidence row for the requested release SHA plus owner membership, settings, seven-day operating hours, booking configuration, an active service, and tenant-binding consistency.

## Supabase Advisor

The production security advisor was run after the DDL changes. It reported existing `INFO` findings for tables with RLS enabled and no policies. The Phase G provisioning evidence table is intentionally inaccessible to `public`, `anon`, and `authenticated` and is service-role-only. The broader existing advisor findings are not silently treated as Phase G failures; they remain repository/security debt to be handled under their governing authority rather than by widening Phase G scope.

## Production impact

Production touched: **YES**.

Changes were limited to canonical schema compatibility/hardening, provisioning functions/evidence, and the proof tenant. Transactional smoke rows were rolled back. No paid resource was created.

## Phase boundary

Phase H is not implemented here. Phase H must prove repeatability with Clinics #3–#5 through the same mechanism without source-code changes for ordinary clinic differences.
