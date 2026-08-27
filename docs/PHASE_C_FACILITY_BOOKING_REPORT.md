# Phase C — Facility + Booking Report

Base: `origin/main` at `c6e5e2f76f416a305fefd3013b570349950a311f`, containing merged Phase B.

## Completed

- Extended the canonical configuration repository to read/write tenant-scoped rooms, generic resources, and booking rules.
- Added authenticated `/api/settings/facility`; mutations reuse `settings.manage` and bind both tenant keys.
- Added deterministic bulk expansion, including `6 rooms × 2 beds = 12 beds`, without clinic-specific code.
- Removed fixed `ROOM_CAPACITY`, four-bed limits, hourly starts, and 60-minute duration from active booking.
- Implemented simple/provider, capacity, and opt-in specific-resource decisions with fail-closed hours, interval, duplicate, provider, resource, capacity, active state, and gender rules.
- Kept the existing Sheets appointment ledger and route as the sole operational writer. Live Chamber remains separate treatment-time authority.
- Added server-side `core.appointments` entitlement gating alongside membership and `appointment.create`.
- Made booking UI use configured slots, duration, provider/resource requirements, and timezone.
- Extended readiness with explicit Phase C reasons without claiming full onboarding readiness.

## Canonical paths and authority

- Repository: `lib/data/clinicConfiguration.ts`
- Bulk planner: `lib/domain/tenancy/facilityConfiguration.ts`
- Booking decision: `lib/domain/appointments/configuredBooking.ts`
- Operational writer: `lib/domain/appointments/capacityBooking.ts`
- Routes: `app/api/settings/facility`, `app/api/appointments`, `app/api/appointments/capacity-booking`, `app/api/appointments/validate`

No migration was added. Phase A already contains the required composite keys, tenant foreign keys, RLS, grants, and booking constraints. No dual writer was introduced.

## Verification and isolation evidence

`tests/phaseCFacilityBooking.test.ts` executes the actual bulk planner and resolver. It covers simple booking, configured capacity, one-room and six-room/twelve-bed clinics, overlapping local codes, same clinic ID in another organization, foreign configuration/hours, missing/partial scope, missing config, invalid hours/interval, duplicate/provider policy, inactive/runtime-only resources, specific-resource capacity, and gender restriction.

Repository history still lacks production-applied `create_relife_chamber_core`. Since this phase adds no SQL, no misleading clean replay was attempted; Phase A's PostgreSQL 16.13 execution evidence remains applicable. Real Supabase Advisors were not run because no free isolated branch was available. The current Supabase changelog was reviewed.

## Fixed assumptions and remaining debt

The active booking path no longer contains fixed `ROOM_CAPACITY`, four-patient ceiling, `BED-1..4` inference, fixed Chamber starts, or fixed 60-minute duration. The fixed-identity ledger remains 113 occurrences across 28 files because this slice did not move or disguise those tenant identities. Legacy Chamber runtime and Sheets adapters retain named compatibility debt but are not the generic booking authority.

## Limitations and next phase

This does not claim full productization or onboarding. Finance/staff configuration, broader owner setup UX, imports/exports, platform administration, production migration, and real Clinic #2 proof remain later phases. Live Chamber allocation remains separate and carries compatibility code; its cutover needs live-data parity evidence rather than booking-time reservation changes.

Phase D may start after merge. Production was not touched and no paid resource was created.
