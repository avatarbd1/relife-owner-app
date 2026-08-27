# Phase H — Repeatability Proof

Status: implementation/proof record for `docs/TWENTY_CLINIC_PRODUCTION_CONTRACT.md` Phase H.

Base main SHA: `4844c25c25ba0b8a7af70dc793334f126ff14b74`.

## Objective

Prove that ordinary clinic differences are configuration/data, not source-code branches, by onboarding Clinics #3–#5 through the same canonical `relife.provision_clinic_v1(jsonb)` mechanism.

## Generic mechanism improvement

Phase G's provisioner already handled organization, clinic profile, owner membership, hours, features/entitlements, services, and booking configuration. Phase H extends that same function to accept `rooms` and `resources` arrays and removes the Phase G-specific entitlement `plan_code` hard-code. The provisioner remains service-role-only.

No Clinic #3/#4/#5-specific source file, code branch, or conditional was added.

## Production proof clinics

### Clinic #3 — Physio capacity booking

- Clinic ID: `cdfa83e3-472c-43fa-a8a9-4e8ec26221dd`
- Organization ID: `d1b2c690-5ec8-441b-8694-991a4d0f443c`
- Type: physiotherapy
- Booking: capacity
- Rooms: 2
- Resources: 4 runtime-only beds
- Active services: 2
- Enabled features: 9
- Basic finance entitlement: active
- Plan code: `phase-h-physio`

### Clinic #4 — Dental specific-resource booking

- Clinic ID: `cbc8b4ee-b026-4459-af08-3ecdfa7491e5`
- Organization ID: `82774b1b-4387-4906-b05b-91378031e306`
- Type: dental
- Booking: specific resource
- Rooms: 1
- Resources: 2 bookable dental chairs
- Active services: 2
- Enabled features: 10
- Basic finance entitlement: active
- Plan code: `phase-h-dental`

### Clinic #5 — Physio simple/provider booking with no resources

- Clinic ID: `0e19810b-0a67-4c51-847a-f8e07c20b733`
- Organization ID: `10d227ae-8bbf-41af-8347-90d4c4772e73`
- Type: physiotherapy
- Booking: simple
- Rooms: 0
- Resources: 0
- Active services: 1
- Enabled features: 9
- Basic finance entitlement: active
- Plan code: `phase-h-simple`

Clinic #5 was intentionally reprovisioned through the same function after an initial Doctor Chamber configuration exposed that the current finance ledger department contract remains Physio/Dental-only. The reprovision changed ordinary configuration without changing source code. Doctor Chamber runtime/finance parity is therefore not claimed by Phase H and remains a bounded product-capability gap rather than a fake repeatability pass.

## Operational smoke

A single production transaction inserted one tenant-scoped patient-cache row, appointment row, and finance row for each of Clinics #3–#5. All nine rows were visible only under their exact composite tenant keys during the transaction.

Observed inside the transaction:

- patient rows: 3
- appointment rows: 3
- finance rows: 3
- patient scope mismatches: 0
- appointment scope mismatches: 0
- finance scope mismatches: 0

Negative mismatched `(organization_id, clinic_id)` writes were rejected by composite tenant foreign keys. The transaction was rolled back; smoke business rows must remain absent after verification.

## Readiness/activation rule

Each proof clinic remains `setup` until evidence is recorded against the final Phase H branch HEAD using `record_clinic_readiness_v1`. Activation uses `activate_clinic_v1` and therefore requires verified evidence plus owner membership, clinic settings, seven operating-hour rows, booking config, active service, and zero tenant-binding mismatch.

Required evidence keys remain:

- `tenantIsolation`
- `schemaReady`
- `ownerMembership`
- `configurationReady`
- `bookingReady`
- `financeReady`
- `noRelifeFallback`
- `rollbackReady`
- `coreOperationalSmoke`

Missing evidence fails closed.

## Clinics #6–#20 rollout runbook

Do not create per-clinic branches, Supabase projects, Render services, or source-code conditionals for ordinary differences.

For each new clinic:

1. Collect one configuration payload: organization, clinic profile, owner staff ID, operating hours, enabled features/plan, rooms/resources, services/prices, booking rules, and any approved import mapping.
2. Run the current canonical `provision_clinic_v1` with service-role platform authority. The clinic must begin in `setup`.
3. Verify exact owner membership, settings, seven-day hours, enabled features/entitlements, services, facility/resource shape, booking config, finance entitlement/config, and any storage/import mapping that is actually used.
4. Run tenant-negative probes and transaction-scoped patient/appointment/finance smoke. Roll test business rows back.
5. Confirm no active commercial path depends on a Relife-only fallback for this tenant.
6. Record readiness against the exact release SHA only after all evidence is true.
7. Activate through `activate_clinic_v1`; never update `clinics.status` directly as a shortcut.
8. Re-query post-activation mismatch counts and audit/evidence state.
9. Batch rollout only after the preceding clinic passes. A practical commercial batch may include several configuration payloads, but each clinic retains independent readiness evidence and activation.

If an ordinary difference cannot be expressed by the current payload/schema, stop the batch and add one generic platform capability. Do not add a clinic-name/clinic-ID conditional.

## Current limitation

The master contract lists Doctor Chamber as a template category, but the existing core finance ledger department constraint is still Physio/Dental-oriented. Phase H does not claim Doctor Chamber commercial runtime parity. This limitation does not invalidate the demonstrated repeatability of the three accepted proof configurations, but it must be resolved before selling Doctor Chamber as a fully supported core-finance template.
