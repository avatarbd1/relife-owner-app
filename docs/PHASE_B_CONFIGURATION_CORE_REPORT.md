# Phase B — Configuration Core Report

Base: `origin/main` containing Phase A (`b58976b49e6db67d5a75cdad7a0b3a8c21a461ea`)

## Completed

- Added one typed application-facing configuration resolution layer with explicit tenant scope and distinct `not_authorized`, `not_configured`, `disabled`, `not_entitled`, and `invalid` outcomes.
- Added one canonical Supabase repository for clinic profile/settings, operating hours, feature flags/entitlements, and services/pricing. Every tenant-owned query and mutation binds `organization_id + clinic_id`.
- Added authenticated clinic profile/hours and service configuration APIs. Mutations reuse `settings.manage`; tenant membership/permission and commercial entitlement remain separate checks.
- Replaced the fixed Settings display of Relife hours/services with canonical tenant configuration. Missing configuration shows a fail-closed state and never substitutes Relife values.
- Made relevant More navigation feature-aware while retaining independent RBAC checks. Inventory and live Chamber APIs also enforce the canonical feature decision server-side, so UI hiding is not authorization.
- Replaced the empty `clinic_memberships` readiness lookup with canonical `staff_tenant_bindings` and real Phase B configuration checks with explicit reasons.

## Canonical readers and writers

- Reader/writer: `lib/data/clinicConfiguration.ts`
- Resolution/default/fail-closed policy: `lib/domain/tenancy/configurationCore.ts`
- Server feature gate: `lib/domain/tenancy/featureGuard.ts`
- Routes: `app/api/settings/clinic/route.ts`, `app/api/settings/services/route.ts`, `app/api/setup/clinic-validation/route.ts`
- Consumers: `components/V1SettingsClient.tsx`, `app/(dashboard)/more/page.tsx`

No new migration was needed; Phase A already represents every field used here. No clinic-specific rows or hard-coded prices were added.

## Isolation and verification evidence

`tests/phaseBConfigurationCore.test.ts` executes the actual resolver/readiness functions with two organizations/clinics. It covers missing and partial tenant identity, the same clinic-local ID under another organization, foreign hours/flags/entitlements, all required feature/grant time and status cases, optional/required settings, timezone/hours, inactive services, clinic-specific prices, explicit readiness reasons, and permission versus entitlement denial.

The Phase A migration was not replayed because this PR changes no SQL and repository history still lacks the production-applied `create_relife_chamber_core` baseline. Phase A's PostgreSQL 16.13 execution evidence remains the applicable schema evidence. Real Supabase Advisors were not run; no free isolated Supabase branch was available. The current Supabase changelog was reviewed; no entry changes the Phase A client-private/service-role access model used here.

## Fixed-Relife debt

The authoritative compatibility ratchet remains the named ledger in `tests/phaseARelifeCompatibilityBoundary.test.ts`. Phase B removes the fixed Settings hours/service presentation without moving identity literals behind constants. Remaining ledger debt belongs to legacy Sheets/data routing, finance/workforce compatibility, Edge bootstrap, and Phase C booking/Chamber paths; it is not mass-removed here because their authorities and rollout gates differ.

## Limitations and Phase C deferrals

This does not claim full onboarding readiness or multi-clinic productization. Generic appointment capacity, `ROOM_CAPACITY`, `BED-1..4`, booking-time resource allocation, Chamber runtime allocation, finance configuration, import/export, platform admin, and production deployment/migration execution remain deferred. The repository migration-baseline drift also remains unresolved.

Phase C may start after this PR is merged; its booking/facility work must consume Phase A resources/configuration without changing the Phase B profile/service authority.
